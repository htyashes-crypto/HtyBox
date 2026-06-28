//! Host 反连 relay 客户端（`Document/03-protocol-spec.md` §9）。
//!
//! 控制 socket 出站连 relay `/session/{serverId}` 发 `sync`，退避重连；收 `connected{connId}`
//! 即开一条数据 socket `/session/{serverId}/{connId}` 跑 transport 无关核心
//! [`crate::ws_host::run_conn`]（`is_remote=true` 强制 E2E）——与 LAN 入站复用同一套
//! E2E/RPC/终端逻辑。relay 只逐字节转发密文，Host 私钥永不出本机。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as TMsg;

use crate::host_identity::HostIdentity;
use crate::terminal_core::TerminalCore;
use crate::ws_host::{run_conn, WsMsg};
use htybox_link::relay::{control_url, data_url, RelayControl};
use htybox_link::rpc::WorkspacesResult;

type WsClient =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 反连主循环：控制 socket 退避重连，期间维护 `online` 状态。Step 4 持其 `JoinHandle`，
/// 在停用/改配置时 `abort()` 即停（abort 后调用方应把 `online` 置 false）。
pub async fn run(
    endpoint: String,
    use_tls: bool,
    core: Arc<TerminalCore>,
    identity: Arc<HostIdentity>,
    workspaces: Arc<Mutex<WorkspacesResult>>,
    online: Arc<AtomicBool>,
) {
    let server_id = identity.server_id().to_string();
    let mut backoff = 500u64;
    loop {
        let url = control_url(&endpoint, use_tls, &server_id);
        if let Ok((ws, _)) = connect_async(url.as_str()).await {
            backoff = 500;
            online.store(true, Ordering::Relaxed);
            run_control(ws, &endpoint, use_tls, &server_id, &core, &identity, &workspaces).await;
            online.store(false, Ordering::Relaxed);
        }
        tokio::time::sleep(Duration::from_millis(backoff)).await;
        backoff = (backoff * 2).min(8000);
    }
}

/// 控制 socket：发 `sync` → 读 `connected`/`ping` → 开数据 socket / 回 `pong`。
async fn run_control(
    ws: WsClient,
    endpoint: &str,
    use_tls: bool,
    server_id: &str,
    core: &Arc<TerminalCore>,
    identity: &Arc<HostIdentity>,
    workspaces: &Arc<Mutex<WorkspacesResult>>,
) {
    let (mut sink, mut stream) = ws.split();
    let sync = serde_json::to_string(&RelayControl::Sync).unwrap_or_default();
    if sink.send(TMsg::Text(sync.into())).await.is_err() {
        return;
    }
    // 写通道：读循环需向 sink 回 pong，而 sink 已被 split 走 → 经 mpsc + 写任务
    let (ctl_tx, mut ctl_rx) = mpsc::unbounded_channel::<TMsg>();
    let writer = tokio::spawn(async move {
        while let Some(m) = ctl_rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
    });
    let mut data_tasks: Vec<JoinHandle<()>> = Vec::new();
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            TMsg::Text(t) => match serde_json::from_str::<RelayControl>(t.as_str()) {
                Ok(RelayControl::Connected { connection_id }) => {
                    data_tasks.retain(|h| !h.is_finished());
                    data_tasks.push(spawn_data_socket(
                        endpoint, use_tls, server_id, &connection_id, core, identity, workspaces,
                    ));
                }
                Ok(RelayControl::Ping) => {
                    let pong = serde_json::to_string(&RelayControl::Pong).unwrap_or_default();
                    let _ = ctl_tx.send(TMsg::Text(pong.into()));
                }
                _ => {}
            },
            TMsg::Ping(p) => {
                let _ = ctl_tx.send(TMsg::Pong(p));
            }
            TMsg::Close(_) => break,
            _ => {}
        }
    }
    writer.abort();
    for h in data_tasks {
        h.abort();
    }
}

/// 开一条数据 socket 连 relay `/session/{serverId}/{connId}`，跑核心连接逻辑。
fn spawn_data_socket(
    endpoint: &str,
    use_tls: bool,
    server_id: &str,
    connection_id: &str,
    core: &Arc<TerminalCore>,
    identity: &Arc<HostIdentity>,
    workspaces: &Arc<Mutex<WorkspacesResult>>,
) -> JoinHandle<()> {
    let url = data_url(endpoint, use_tls, server_id, connection_id);
    let core = core.clone();
    let identity = identity.clone();
    let workspaces = workspaces.clone();
    tokio::spawn(async move {
        if let Ok((ws, _)) = connect_async(url.as_str()).await {
            run_data_socket(ws, core, identity, workspaces).await;
        }
    })
}

/// tokio-tungstenite 出站数据 socket 适配器：把 relay 数据 socket 桥接到 [`run_conn`]（与 axum 入站同构）。
async fn run_data_socket(
    ws: WsClient,
    core: Arc<TerminalCore>,
    identity: Arc<HostIdentity>,
    workspaces: Arc<Mutex<WorkspacesResult>>,
) {
    let (mut sink, mut stream) = ws.split();
    let (in_tx, in_rx) = mpsc::unbounded_channel::<WsMsg>();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<WsMsg>();

    // reader：tungstenite 帧 → 规范化 WsMsg
    let reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            let wm = match msg {
                TMsg::Text(t) => WsMsg::Text(t.to_string()),
                TMsg::Binary(b) => WsMsg::Binary(b.to_vec()),
                TMsg::Close(_) => break,
                _ => continue,
            };
            if in_tx.send(wm).is_err() {
                return;
            }
        }
        let _ = in_tx.send(WsMsg::Close);
    });

    // writer：规范化 WsMsg → tungstenite 帧
    let writer = tokio::spawn(async move {
        while let Some(wm) = out_rx.recv().await {
            let msg = match wm {
                WsMsg::Text(s) => TMsg::Text(s.into()),
                WsMsg::Binary(b) => TMsg::Binary(b.into()),
                WsMsg::Close => {
                    let _ = sink.send(TMsg::Close(None)).await;
                    break;
                }
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // relay 数据 socket = 远程客户端连接，强制 E2E（is_remote=true）
    run_conn(in_rx, out_tx, core, identity, workspaces, true).await;
    reader.abort();
    writer.abort();
}
