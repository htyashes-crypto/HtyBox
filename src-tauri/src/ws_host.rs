//! 本机 WS Host（L2）：把 `htybox-link` 协议暴露给客户端（仅 `127.0.0.1` 明文）。
//!
//! 跑在 Tauri 自带的 tokio runtime 上（`tauri::async_runtime::spawn`）。单条 WS 混合
//! JSON-RPC（文本帧）+ 二进制终端帧；终端数据来自共享的 `TerminalCore`（与本地前端同源）。
//! 配对 / E2E / LAN / relay 留后续阶段；本阶段安全边界 = 本机 + Host 头白名单。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::host_identity::HostIdentity;
use crate::pty::SpawnOptions;
use crate::terminal_core::TerminalCore;
use htybox_link::e2e::{public_from_b64, E2eeHello, E2eeReady, SalsaBox};
use htybox_link::frame::{open_frame, seal_frame, InnerKind};
use htybox_link::handshake::{Features, Hello, ServerInfo};
use htybox_link::rpc::{
    self, types, CreateTerminalParams, RenameTerminalParams, Response as RpcResponse, RestoreMode,
    SubscribeTerminalParams, SubscribeTerminalResult, TerminalInfo, TerminalListResult, TerminalRef,
    WorkspacesResult,
};
use htybox_link::terminal::{decode_frame, decode_resize, encode_revision_frame, Opcode};

static NEXT_TERM: AtomicU64 = AtomicU64::new(1);
fn new_term_id() -> String {
    format!("wsterm-{}", NEXT_TERM.fetch_add(1, Ordering::Relaxed))
}
fn server_id() -> String {
    format!("htybox-{}", std::process::id())
}
fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "HtyBox Host".to_string())
}

/// 同步绑定端口（6767 起，占用 +1 探测）。`lan=true` 绑 `0.0.0.0`(覆盖本地+局域网)，否则仅 `127.0.0.1`。
pub fn bind(lan: bool) -> std::net::TcpListener {
    let host: &str = if lan { "0.0.0.0" } else { "127.0.0.1" };
    for port in 6767..6867u16 {
        if let Ok(l) = std::net::TcpListener::bind((host, port)) {
            return l;
        }
    }
    std::net::TcpListener::bind((host, 0)).expect("ws host bind")
}

/// axum 共享状态：终端核心 + Host 身份。
#[derive(Clone)]
struct WsState {
    core: Arc<TerminalCore>,
    identity: Arc<HostIdentity>,
}

/// 在 tokio 上跑 axum WS server（消费 `bind()` 得到的 std listener）。
pub async fn serve(std_listener: std::net::TcpListener, core: Arc<TerminalCore>, identity: Arc<HostIdentity>) {
    if std_listener.set_nonblocking(true).is_err() {
        return;
    }
    let listener = match tokio::net::TcpListener::from_std(std_listener) {
        Ok(l) => l,
        Err(_) => return,
    };
    let app = Router::new().route("/ws", any(ws_upgrade)).with_state(WsState { core, identity });
    let _ = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await;
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(st): State<WsState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    if !host_allowed(&headers, &addr) {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    let is_remote = !addr.ip().is_loopback();
    ws.on_upgrade(move |socket| handle_conn(socket, st.core, st.identity, is_remote))
}

/// 本机连接：Host 头须 localhost（防浏览器 DNS rebinding）。远程(LAN)：放行——E2E + 公钥信任另行强制。
fn host_allowed(headers: &HeaderMap, addr: &SocketAddr) -> bool {
    if !addr.ip().is_loopback() {
        return true;
    }
    match headers.get(axum::http::header::HOST).and_then(|v| v.to_str().ok()) {
        None => true,
        Some(h) => {
            let host = h.rsplit_once(':').map(|(a, _)| a).unwrap_or(h);
            matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
        }
    }
}

/// 出站消息：writer 按是否加密决定封装为 WS Text/Binary（明文）或密文信封。
enum Outbound {
    Json(String),
    Terminal(Vec<u8>),
}

/// 校验 `e2ee_hello` 并用 Host 私钥协商加密盒；非 e2ee_hello/公钥无效返回 None。
fn try_make_box(identity: &HostIdentity, text: &str) -> Option<SalsaBox> {
    let hello: E2eeHello = serde_json::from_str(text).ok()?;
    if hello.kind != E2eeHello::TYPE {
        return None;
    }
    let client_pub = public_from_b64(&hello.key).ok()?;
    Some(identity.keypair().box_with(&client_pub))
}

/// 单连接状态（read loop 单线程持有；forwarder 任务只持 out 克隆，不碰这些 map）。
struct Conn {
    core: Arc<TerminalCore>,
    out: mpsc::UnboundedSender<Outbound>,
    cipher: Option<Arc<SalsaBox>>, // Some = E2E 加密通道（read loop 解，writer 封）
    next_slot: u8,
    slot_term: HashMap<u8, String>,
    forwarders: HashMap<u8, JoinHandle<()>>,
}

async fn handle_conn(socket: WebSocket, core: Arc<TerminalCore>, identity: Arc<HostIdentity>, is_remote: bool) {
    let (mut sink, mut stream) = socket.split();

    // ── E2E 协商（看首帧）：e2ee_hello→建盒+回 ready；远程无 E2E→拒；本机明文→首帧作业务 ──
    let mut cipher: Option<Arc<SalsaBox>> = None;
    let mut first_business: Option<Message> = None;
    match stream.next().await {
        Some(Ok(Message::Text(t))) => {
            if let Some(b) = try_make_box(&identity, &t) {
                let ready = serde_json::to_string(&E2eeReady::default()).unwrap_or_default();
                if sink.send(Message::Text(ready.into())).await.is_err() {
                    return;
                }
                cipher = Some(Arc::new(b));
            } else if is_remote {
                let _ = sink.send(Message::Close(None)).await;
                return;
            } else {
                first_business = Some(Message::Text(t));
            }
        }
        Some(Ok(msg)) => {
            if is_remote {
                let _ = sink.send(Message::Close(None)).await;
                return;
            }
            first_business = Some(msg);
        }
        _ => return,
    }

    // ── 写任务：持 cipher，按需封装出站 ──
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Outbound>();
    let cipher_w = cipher.clone();
    let writer = tokio::spawn(async move {
        while let Some(o) = out_rx.recv().await {
            let msg = match (&cipher_w, o) {
                (Some(b), Outbound::Json(s)) => Message::Binary(seal_frame(b, InnerKind::Json, s.as_bytes()).into()),
                (Some(b), Outbound::Terminal(t)) => Message::Binary(seal_frame(b, InnerKind::Terminal, &t).into()),
                (None, Outbound::Json(s)) => Message::Text(s.into()),
                (None, Outbound::Terminal(t)) => Message::Binary(t.into()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut conn = Conn {
        core,
        out: out_tx,
        cipher,
        next_slot: 0,
        slot_term: HashMap::new(),
        forwarders: HashMap::new(),
    };
    if let Some(m) = first_business {
        conn.on_inbound(m);
    }
    while let Some(Ok(msg)) = stream.next().await {
        if matches!(msg, Message::Close(_)) {
            break;
        }
        conn.on_inbound(msg);
    }
    for (_, h) in conn.forwarders.drain() {
        h.abort();
    }
    drop(conn); // 丢 out_tx → 写任务自然结束
    writer.abort();
}

impl Conn {
    fn send_json<T: Serialize>(&self, v: &T) {
        let _ = self.out.send(Outbound::Json(serde_json::to_string(v).unwrap_or_default()));
    }
    fn send_binary(&self, bytes: Vec<u8>) {
        let _ = self.out.send(Outbound::Terminal(bytes));
    }
    /// 入站分发：加密通道→`open_frame` 解后按 InnerKind 派发；明文→Text=JSON / Binary=终端帧。
    fn on_inbound(&mut self, msg: Message) {
        match (&self.cipher, msg) {
            (Some(b), Message::Binary(data)) => {
                if let Ok((kind, plain)) = open_frame(b, data.as_ref()) {
                    match kind {
                        InnerKind::Json => {
                            if let Ok(s) = std::str::from_utf8(&plain) {
                                self.handle_text(s);
                            }
                        }
                        InnerKind::Terminal => self.handle_binary(&plain),
                    }
                }
            }
            (None, Message::Text(t)) => self.handle_text(&t),
            (None, Message::Binary(b)) => self.handle_binary(b.as_ref()),
            _ => {}
        }
    }
    fn send_err(&self, req_id: &str, req_type: &str, error: &str, code: &str) {
        self.send_json(&rpc::RpcError {
            kind: "rpc_error".to_string(),
            request_id: if req_id.is_empty() { None } else { Some(req_id.to_string()) },
            request_type: req_type.to_string(),
            error: error.to_string(),
            code: code.to_string(),
        });
    }

    fn handle_text(&mut self, text: &str) {
        let v: Value = match serde_json::from_str(text) {
            Ok(v) => v,
            Err(_) => return,
        };
        let t = v.get("type").and_then(Value::as_str).unwrap_or("");
        let req_id = v.get("requestId").and_then(Value::as_str).unwrap_or("").to_string();

        if t == Hello::TYPE {
            self.send_json(&ServerInfo::new(
                server_id(),
                host_name(),
                env!("CARGO_PKG_VERSION"),
                Features { terminal_restore: true, pairing: false, relay: false },
            ));
            return;
        }

        match t {
            types::TERMINAL_CREATE_REQ => {
                let p: CreateTerminalParams = serde_json::from_value(v.clone()).unwrap_or_default();
                let id = new_term_id();
                let opts = SpawnOptions { shell: p.shell, cwd: p.cwd, cols: p.cols, rows: p.rows, env: p.env };
                match self.core.create(id.clone(), opts, None, p.workspace_id) {
                    Ok(()) => self.send_json(&RpcResponse::new(
                        types::TERMINAL_CREATE_RESP,
                        req_id,
                        rpc::CreateTerminalResult { terminal_id: id },
                    )),
                    Err(e) => self.send_err(&req_id, types::TERMINAL_CREATE_REQ, &e, "internal"),
                }
            }
            types::TERMINAL_LIST_REQ => {
                let terminals = self
                    .core
                    .list()
                    .into_iter()
                    .map(|(id, m)| TerminalInfo {
                        terminal_id: id,
                        title: m.title,
                        cwd: m.cwd,
                        cols: m.cols,
                        rows: m.rows,
                        workspace_id: m.workspace_id,
                    })
                    .collect();
                self.send_json(&RpcResponse::new(types::TERMINAL_LIST_RESP, req_id, TerminalListResult { terminals }));
            }
            types::TERMINAL_SUBSCRIBE_REQ => match serde_json::from_value::<SubscribeTerminalParams>(v.clone()) {
                Ok(p) => self.subscribe(&req_id, p),
                Err(_) => self.send_err(&req_id, types::TERMINAL_SUBSCRIBE_REQ, "bad subscribe params", "bad_request"),
            },
            types::TERMINAL_UNSUBSCRIBE_REQ => {
                if let Ok(p) = serde_json::from_value::<TerminalRef>(v.clone()) {
                    self.unsubscribe(&p.terminal_id);
                }
                self.send_json(&RpcResponse::new(types::TERMINAL_UNSUBSCRIBE_RESP, req_id, serde_json::json!({})));
            }
            types::TERMINAL_KILL_REQ => {
                if let Ok(p) = serde_json::from_value::<TerminalRef>(v.clone()) {
                    let _ = self.core.close(&p.terminal_id);
                }
                self.send_json(&RpcResponse::new(types::TERMINAL_KILL_RESP, req_id, serde_json::json!({})));
            }
            types::TERMINAL_RENAME_REQ => {
                if let Ok(p) = serde_json::from_value::<RenameTerminalParams>(v.clone()) {
                    let _ = self.core.rename(&p.terminal_id, p.title);
                }
                self.send_json(&RpcResponse::new(types::TERMINAL_RENAME_RESP, req_id, serde_json::json!({})));
            }
            types::HOST_WORKSPACES_LIST_REQ => {
                self.send_json(&RpcResponse::new(types::HOST_WORKSPACES_LIST_RESP, req_id, WorkspacesResult { workspaces: vec![] }));
            }
            other => {
                if !req_id.is_empty() {
                    self.send_err(&req_id, other, "unsupported rpc", "unsupported");
                }
            }
        }
    }

    fn subscribe(&mut self, req_id: &str, p: SubscribeTerminalParams) {
        let sub = match self.core.subscribe(&p.terminal_id) {
            Some(s) => s,
            None => {
                self.send_err(req_id, types::TERMINAL_SUBSCRIBE_REQ, "no such terminal", "not_found");
                return;
            }
        };
        let slot = self.next_slot;
        self.next_slot = self.next_slot.wrapping_add(1);
        self.slot_term.insert(slot, p.terminal_id.clone());
        self.send_json(&RpcResponse::new(
            types::TERMINAL_SUBSCRIBE_RESP,
            req_id,
            SubscribeTerminalResult { slot, revision: sub.baseline },
        ));
        // visible-snapshot → 先发 Restore（历史重放）；client 按 revision<=baseline 去重
        if matches!(p.restore, RestoreMode::VisibleSnapshot { .. }) && !sub.snapshot.is_empty() {
            self.send_binary(encode_revision_frame(Opcode::Restore, slot, sub.baseline, &sub.snapshot));
        }
        // forwarder：broadcast → Output 帧；Lagged → 重取快照发 Restore 对齐
        let out = self.out.clone();
        let core = self.core.clone();
        let term_id = p.terminal_id.clone();
        let mut rx = sub.rx;
        let h = tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok((rev, bytes)) => {
                        let frame = encode_revision_frame(Opcode::Output, slot, rev, &bytes);
                        if out.send(Outbound::Terminal(frame)).is_err() {
                            break;
                        }
                    }
                    Err(RecvError::Lagged(_)) => {
                        if let Some((base, snap)) = core.snapshot(&term_id) {
                            let frame = encode_revision_frame(Opcode::Restore, slot, base, &snap);
                            if out.send(Outbound::Terminal(frame)).is_err() {
                                break;
                            }
                        }
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        });
        self.forwarders.insert(slot, h);
    }

    fn unsubscribe(&mut self, terminal_id: &str) {
        let slots: Vec<u8> = self
            .slot_term
            .iter()
            .filter(|(_, t)| t.as_str() == terminal_id)
            .map(|(s, _)| *s)
            .collect();
        for s in slots {
            self.slot_term.remove(&s);
            if let Some(h) = self.forwarders.remove(&s) {
                h.abort();
            }
        }
    }

    fn handle_binary(&mut self, data: &[u8]) {
        let f = match decode_frame(data) {
            Ok(f) => f,
            Err(_) => return,
        };
        let term_id = match self.slot_term.get(&f.slot) {
            Some(t) => t.clone(),
            None => return,
        };
        match f.opcode {
            Opcode::Input => {
                let _ = self.core.write(&term_id, f.payload);
            }
            Opcode::Resize => {
                if let Ok(r) = decode_resize(f.payload) {
                    let _ = self.core.resize(&term_id, r.cols, r.rows);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use htybox_link::terminal::{encode_frame, split_revision};
    use std::time::Duration;
    use tokio_tungstenite::tungstenite::Message as TMsg;

    type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    fn start_host() -> u16 {
        let core = Arc::new(TerminalCore::default());
        let identity = Arc::new(HostIdentity::load_or_create());
        let listener = bind(false);
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, core, identity));
        port
    }
    async fn connect(port: u16) -> Ws {
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws"))
            .await
            .unwrap();
        ws
    }
    async fn send_text(ws: &mut Ws, v: Value) {
        ws.send(TMsg::Text(v.to_string().into())).await.unwrap();
    }
    async fn recv_json(ws: &mut Ws) -> Value {
        loop {
            match ws.next().await {
                Some(Ok(TMsg::Text(t))) => return serde_json::from_str(&t).unwrap(),
                Some(Ok(_)) => continue,
                other => panic!("ws closed before json: {other:?}"),
            }
        }
    }
    async fn hello(ws: &mut Ws) {
        send_text(ws, serde_json::json!({"type":"hello","clientId":"t","clientType":"cli","protocolVersion":1,"appVersion":"test","capabilities":{"terminalBinary":true}})).await;
        assert_eq!(recv_json(ws).await["type"], "server_info");
    }
    async fn create_term(ws: &mut Ws) -> String {
        send_text(ws, serde_json::json!({"type":"terminal.create.request","requestId":"rc","cols":80,"rows":24})).await;
        let cr = recv_json(ws).await;
        assert_eq!(cr["type"], "terminal.create.response");
        cr["payload"]["terminalId"].as_str().unwrap().to_string()
    }
    async fn subscribe(ws: &mut Ws, term_id: &str, rid: &str) -> u8 {
        send_text(ws, serde_json::json!({"type":"terminal.subscribe.request","requestId":rid,"terminalId":term_id,"restore":{"mode":"visible-snapshot"}})).await;
        let sr = recv_json(ws).await;
        assert_eq!(sr["type"], "terminal.subscribe.response");
        sr["payload"]["slot"].as_u64().unwrap() as u8
    }
    async fn wait_marker(ws: &mut Ws, marker: &str) -> bool {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                match ws.next().await {
                    Some(Ok(TMsg::Binary(b))) => {
                        if let Ok(f) = decode_frame(&b) {
                            if matches!(f.opcode, Opcode::Output | Opcode::Restore) {
                                if let Ok((_r, data)) = split_revision(f.payload) {
                                    if String::from_utf8_lossy(data).contains(marker) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(_)) => continue,
                    _ => return false,
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn create_subscribe_input_output() {
        let port = start_host();
        let mut ws = connect(port).await;
        hello(&mut ws).await;
        let id = create_term(&mut ws).await;
        let slot = subscribe(&mut ws, &id, "rs").await;
        ws.send(TMsg::Binary(encode_frame(Opcode::Input, slot, b"echo HTYBOXOK\r\n").into()))
            .await
            .unwrap();
        assert!(wait_marker(&mut ws, "HTYBOXOK").await, "未收到回显 HTYBOXOK");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_clients_share_and_history() {
        let port = start_host();
        // A 建终端 + 订阅 + 产生历史输出
        let mut a = connect(port).await;
        hello(&mut a).await;
        let id = create_term(&mut a).await;
        let slot_a = subscribe(&mut a, &id, "ra").await;
        a.send(TMsg::Binary(encode_frame(Opcode::Input, slot_a, b"echo SHARED1\r\n").into()))
            .await
            .unwrap();
        assert!(wait_marker(&mut a, "SHARED1").await, "A 未见 SHARED1");
        // B 后加入、订阅同一终端 → visible-snapshot 历史重放应含 SHARED1
        let mut b = connect(port).await;
        hello(&mut b).await;
        let _slot_b = subscribe(&mut b, &id, "rb").await;
        assert!(wait_marker(&mut b, "SHARED1").await, "B 未在历史重放看到 SHARED1");
        // A 再输入 → B 实时可见
        a.send(TMsg::Binary(encode_frame(Opcode::Input, slot_a, b"echo SHARED2\r\n").into()))
            .await
            .unwrap();
        assert!(wait_marker(&mut b, "SHARED2").await, "B 未实时看到 SHARED2");
    }
}
