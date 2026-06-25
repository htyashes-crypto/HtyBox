//! M7-A · 多 Agent 协作 MCP Broker —— 本地 HTTP MCP server（Streamable HTTP，仅 POST/JSON）。
//!
//! Claude/Codex agent 经各自 `.mcp.json` 连上来；broker 按 **per-agent Bearer token** 识别身份，
//! 承载最小协作工具：`whoami` / `list_agents` / `send_message` / `read_inbox`。
//!
//! 协议依据 MCP 2025-06-18《Transports》：
//! - 单一 MCP 端点，支持 POST/GET；
//! - POST 一个 JSON-RPC *请求* → 可直接回 `application/json` 单个响应（无需 SSE）；
//! - POST *通知/响应*（无 id）→ 回 202；
//! - GET → 回 405（声明本端点不提供服务端 SSE 流；M7-A 唤醒走 PTY 注入，不靠 MCP 推送）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response, Server};

const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub agent_id: String,
    pub role: String,      // "lead" | "worker"
    pub role_name: String, // 自定义角色名，如 "维护员"
    pub workspace: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxMsg {
    from: String, // 发送者 agentId（"system" = 系统）
    content: String,
    msg_type: String,
    seq: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    assigner: String,   // 派活者 agentId（Lead）
    worker: String,     // 承接者 agentId
    task: String,       // 任务内容
    file_scope: String, // 文件范围（空=未限定）
    status: String,     // "assigned" | "done"
    summary: String,    // report_result 回填
}

#[derive(Default)]
struct Store {
    by_token: HashMap<String, AgentInfo>, // token -> 身份
    inbox: HashMap<String, Vec<InboxMsg>>, // agentId -> 未读
    state: HashMap<String, String>,        // agentId -> "working"|"idle"|"pending"|"waiting"
    tasks: Vec<Task>,                      // 任务板（assign_task/report_result）
    shared: HashMap<String, String>,       // 黑板（read_shared/write_shared，含总目标）
    last_to: HashMap<String, (u64, u32)>,  // 目标 agentId -> (上条内容哈希, 连续重复次数)：死循环检测
    claims: HashMap<String, String>,       // 归一化文件路径 -> 占用者 agentId（文件归属登记/冲突防护）
    seq: u64,
}

pub struct Broker {
    port: u16,
    store: Mutex<Store>,
    app: Mutex<Option<AppHandle>>, // setup 后注入，用于 emit "agent-wake"（半自动唤醒）
}

impl Broker {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 注册一个 agent（开启团队/新建 agent 终端前调用）：token -> 身份。
    pub fn register(&self, token: String, info: AgentInfo) {
        let mut s = self.store.lock().unwrap();
        s.inbox.entry(info.agent_id.clone()).or_default();
        s.state.insert(info.agent_id.clone(), "working".to_string());
        s.by_token.insert(token, info);
    }

    /// setup 后注入 AppHandle，使 broker 能向前端 emit 事件（半自动唤醒）。
    pub fn set_app(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// 向前端发 "agent-wake"：某挂起的 agent 收到新消息，提示用户点击唤醒（半自动）。
    fn emit_wake(&self, target: &AgentInfo, from: &str, preview: &str) {
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            let preview: String = preview.chars().take(80).collect();
            let _ = app.emit(
                "agent-wake",
                json!({
                    "agentId": target.agent_id,
                    "roleName": target.role_name,
                    "workspace": target.workspace,
                    "from": from,
                    "preview": preview,
                }),
            );
        }
    }

    /// 记录一次"投递给 target 的内容"，返回是否疑似死循环（同一内容连续投递 ≥3 次）。
    fn note_delivery_loop(&self, s: &mut Store, target: &str, content: &str) -> bool {
        let h = hash_str(content);
        let entry = s.last_to.entry(target.to_string()).or_insert((0, 0));
        if entry.0 == h {
            entry.1 += 1;
        } else {
            *entry = (h, 1);
        }
        entry.1 >= 3
    }

    /// 向前端发 "agent-loop"：检测到 A↔B 同内容空转，前端据此停自动接力并告警。
    fn emit_loop(&self, from: &str, to: &str, content: &str) {
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            let preview: String = content.chars().take(60).collect();
            let _ = app.emit("agent-loop", json!({ "from": from, "to": to, "preview": preview }));
        }
    }

    fn lookup(&self, token: &str) -> Option<AgentInfo> {
        self.store.lock().unwrap().by_token.get(token).cloned()
    }

    /// JSON-RPC 方法分发；Ok(result) / Err((code, message))。
    fn dispatch(
        &self,
        token: Option<&str>,
        method: &str,
        params: Option<&Value>,
    ) -> Result<Value, (i64, String)> {
        match method {
            "initialize" => {
                // 回显客户端请求的协议版本：codex 原生 MCP 客户端对版本不匹配会拒绝握手
                let pv = params
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(PROTOCOL_VERSION);
                Ok(json!({
                    "protocolVersion": pv,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "htybox-broker", "version": "0.1.0" }
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tool_defs() })),
            "tools/call" => {
                let caller = token
                    .and_then(|t| self.lookup(t))
                    .ok_or((-32001, "未知或缺失的 agent token".to_string()))?;
                let p = params.ok_or((-32602, "缺少 params".to_string()))?;
                let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = p.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let data = self.run_tool(&caller, name, &args)?;
                // MCP CallToolResult：content 数组（文本里放 JSON，agent 自行解析）
                Ok(json!({ "content": [ { "type": "text", "text": data.to_string() } ] }))
            }
            other => Err((-32601, format!("method not found: {other}"))),
        }
    }

    fn run_tool(
        &self,
        caller: &AgentInfo,
        name: &str,
        args: &Value,
    ) -> Result<Value, (i64, String)> {
        let mut s = self.store.lock().unwrap();
        match name {
            "whoami" => Ok(serde_json::to_value(caller).unwrap_or_else(|_| json!({}))),
            "list_agents" => {
                let agents: Vec<Value> = s
                    .by_token
                    .values()
                    .map(|i| {
                        json!({
                            "agentId": i.agent_id, "role": i.role, "roleName": i.role_name,
                            "workspace": i.workspace,
                            "state": s.state.get(&i.agent_id).cloned().unwrap_or_else(|| "working".to_string()),
                        })
                    })
                    .collect();
                Ok(json!({ "agents": agents }))
            }
            "await_next" => {
                // 挂起待对接：声明本回合做完、进入等待池。半自动下不阻塞，agent 应据此结束本回合。
                s.state.insert(caller.agent_id.clone(), "idle".to_string());
                Ok(json!({ "suspended": true, "note": "已挂起待对接：请结束本回合；有新消息时会被唤醒" }))
            }
            "update_status" => {
                let st = args.get("state").and_then(|v| v.as_str()).unwrap_or("working");
                s.state.insert(caller.agent_id.clone(), st.to_string());
                Ok(json!({ "ok": true, "state": st }))
            }
            "list_tasks" => Ok(json!({ "tasks": s.tasks })),
            "write_shared" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "write_shared 需要 key".to_string()))?;
                let val = args
                    .get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                s.shared.insert(key.to_string(), val);
                Ok(json!({ "ok": true }))
            }
            "read_shared" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "read_shared 需要 key".to_string()))?;
                Ok(json!({ "key": key, "value": s.shared.get(key).cloned() }))
            }
            "assign_task" => {
                let worker = args
                    .get("workerId")
                    .or_else(|| args.get("worker"))
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "assign_task 需要 workerId".to_string()))?;
                let task = args
                    .get("task")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "assign_task 需要 task".to_string()))?;
                let scope = args
                    .get("fileScope")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let target = s
                    .by_token
                    .values()
                    .find(|i| i.agent_id == worker || i.role_name == worker)
                    .cloned()
                    .ok_or((-32004, format!("找不到 worker: {worker}")))?;
                s.seq += 1;
                let tid = format!("t{}", s.seq);
                s.tasks.push(Task {
                    id: tid.clone(),
                    assigner: caller.agent_id.clone(),
                    worker: target.agent_id.clone(),
                    task: task.to_string(),
                    file_scope: scope.clone(),
                    status: "assigned".to_string(),
                    summary: String::new(),
                });
                // 通知 worker（进收件箱）+ 唤醒
                s.seq += 1;
                let content = format!(
                    "【任务 {tid}】{task}（文件范围: {}）",
                    if scope.is_empty() { "未限定" } else { &scope }
                );
                let seq = s.seq;
                s.inbox.entry(target.agent_id.clone()).or_default().push(InboxMsg {
                    from: caller.agent_id.clone(),
                    content: content.clone(),
                    msg_type: "task".to_string(),
                    seq,
                });
                let cur = s
                    .state
                    .get(&target.agent_id)
                    .cloned()
                    .unwrap_or_else(|| "working".to_string());
                if cur != "working" {
                    s.state.insert(target.agent_id.clone(), "pending".to_string());
                    self.emit_wake(&target, &caller.agent_id, &content);
                }
                // 死循环检测用原始 task 文本（格式化串含递增 tid，不会重复）
                if self.note_delivery_loop(&mut s, &target.agent_id, task) {
                    self.emit_loop(&caller.agent_id, &target.agent_id, task);
                }
                Ok(json!({ "taskId": tid, "worker": target.agent_id }))
            }
            "report_result" => {
                let tid = args
                    .get("taskId")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "report_result 需要 taskId".to_string()))?;
                let summary = args
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let assigner = {
                    let t = s
                        .tasks
                        .iter_mut()
                        .find(|t| t.id == tid)
                        .ok_or((-32004, format!("找不到任务: {tid}")))?;
                    t.status = "done".to_string();
                    t.summary = summary.clone();
                    t.assigner.clone()
                };
                if let Some(lead) = s.by_token.values().find(|i| i.agent_id == assigner).cloned() {
                    s.seq += 1;
                    let content = format!("【{} 完成 {tid}】{summary}", caller.role_name);
                    let seq = s.seq;
                    s.inbox.entry(lead.agent_id.clone()).or_default().push(InboxMsg {
                        from: caller.agent_id.clone(),
                        content: content.clone(),
                        msg_type: "result".to_string(),
                        seq,
                    });
                    let cur = s
                        .state
                        .get(&lead.agent_id)
                        .cloned()
                        .unwrap_or_else(|| "working".to_string());
                    if cur != "working" {
                        s.state.insert(lead.agent_id.clone(), "pending".to_string());
                        self.emit_wake(&lead, &caller.agent_id, &content);
                    }
                }
                Ok(json!({ "ok": true, "taskId": tid }))
            }
            "broadcast" => {
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "broadcast 需要 content".to_string()))?
                    .to_string();
                let targets: Vec<AgentInfo> = s
                    .by_token
                    .values()
                    .filter(|i| i.agent_id != caller.agent_id)
                    .cloned()
                    .collect();
                for t in &targets {
                    s.seq += 1;
                    let seq = s.seq;
                    s.inbox.entry(t.agent_id.clone()).or_default().push(InboxMsg {
                        from: caller.agent_id.clone(),
                        content: content.clone(),
                        msg_type: "broadcast".to_string(),
                        seq,
                    });
                    let cur = s
                        .state
                        .get(&t.agent_id)
                        .cloned()
                        .unwrap_or_else(|| "working".to_string());
                    if cur != "working" {
                        s.state.insert(t.agent_id.clone(), "pending".to_string());
                        self.emit_wake(t, &caller.agent_id, &content);
                    }
                }
                Ok(json!({ "broadcast": targets.len() }))
            }
            "claim_files" => {
                let paths = args
                    .get("paths")
                    .and_then(|v| v.as_array())
                    .ok_or((-32602, "claim_files 需要 paths(字符串数组)".to_string()))?;
                let mut granted: Vec<String> = vec![];
                let mut conflicts: Vec<Value> = vec![];
                for p in paths {
                    let Some(path) = p.as_str() else { continue };
                    let norm = normalize_path(path);
                    match s.claims.get(&norm) {
                        Some(owner) if owner != &caller.agent_id => {
                            conflicts.push(json!({ "path": path, "owner": owner }));
                        }
                        _ => {
                            s.claims.insert(norm, caller.agent_id.clone());
                            granted.push(path.to_string());
                        }
                    }
                }
                Ok(json!({ "granted": granted, "conflicts": conflicts }))
            }
            "release_files" => {
                let paths = args
                    .get("paths")
                    .and_then(|v| v.as_array())
                    .ok_or((-32602, "release_files 需要 paths".to_string()))?;
                for p in paths {
                    if let Some(path) = p.as_str() {
                        let norm = normalize_path(path);
                        if s.claims.get(&norm) == Some(&caller.agent_id) {
                            s.claims.remove(&norm);
                        }
                    }
                }
                Ok(json!({ "ok": true }))
            }
            "list_claims" => {
                let claims: Vec<Value> = s
                    .claims
                    .iter()
                    .map(|(p, o)| json!({ "path": p, "owner": o }))
                    .collect();
                Ok(json!({ "claims": claims }))
            }
            "read_inbox" => {
                let msgs = s
                    .inbox
                    .get_mut(&caller.agent_id)
                    .map(std::mem::take)
                    .unwrap_or_default();
                Ok(json!({ "messages": msgs }))
            }
            "send_message" => {
                let to = args
                    .get("to")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "send_message 需要 'to'".to_string()))?;
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or((-32602, "send_message 需要 'content'".to_string()))?;
                let msg_type = args
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("message")
                    .to_string();
                // 目标可填 agentId 或 角色名
                let target_info = s
                    .by_token
                    .values()
                    .find(|i| i.agent_id == to || i.role_name == to)
                    .cloned()
                    .ok_or((-32004, format!("找不到目标 agent: {to}")))?;
                let target = target_info.agent_id.clone();
                s.seq += 1;
                let msg = InboxMsg {
                    from: caller.agent_id.clone(),
                    content: content.to_string(),
                    msg_type,
                    seq: s.seq,
                };
                s.inbox.entry(target.clone()).or_default().push(msg);
                // 目标处于挂起(非 working)→ 置 pending 并发唤醒事件（半自动：前端提示用户点击注入）
                let cur = s
                    .state
                    .get(&target)
                    .cloned()
                    .unwrap_or_else(|| "working".to_string());
                let need_wake = cur != "working";
                if need_wake {
                    s.state.insert(target.clone(), "pending".to_string());
                    self.emit_wake(&target_info, &caller.agent_id, content);
                }
                if self.note_delivery_loop(&mut s, &target, content) {
                    self.emit_loop(&caller.agent_id, &target, content);
                }
                Ok(json!({ "delivered": true, "to": target, "wake": need_wake }))
            }
            other => Err((-32601, format!("unknown tool: {other}"))),
        }
    }

    fn handle(&self, mut req: Request) {
        if !req.url().starts_with("/mcp") {
            let _ = req.respond(Response::empty(404));
            return;
        }
        match req.method() {
            Method::Post => {}
            Method::Get => {
                let _ = req.respond(Response::empty(405)); // 不提供服务端 SSE
                return;
            }
            Method::Delete => {
                let _ = req.respond(Response::empty(200)); // 终止会话：无状态，直接 OK
                return;
            }
            _ => {
                let _ = req.respond(Response::empty(405));
                return;
            }
        }

        // 先取出需要的请求头（之后才能可变借用读 body）
        let token = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("authorization"))
            .map(|h| h.value.as_str().trim_start_matches("Bearer ").to_string());

        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);

        let parsed: Value = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(_) => {
                respond_json(
                    req,
                    &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}),
                );
                return;
            }
        };

        // 通知/响应（无 id）→ 202 Accepted，无 body
        let Some(id) = parsed.get("id").cloned() else {
            let _ = req.respond(Response::empty(202));
            return;
        };
        let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let resp = match self.dispatch(token.as_deref(), method, parsed.get("params")) {
            Ok(val) => json!({ "jsonrpc": "2.0", "id": id, "result": val }),
            Err((code, message)) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
            }
        };
        respond_json(req, &resp);
    }
}

fn hash_str(content: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

/// 归一化文件路径用于归属比较：反斜杠转正斜杠 + 全小写（Windows 路径大小写不敏感）。
fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

fn respond_json(req: Request, body: &Value) {
    let json_header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    let resp = Response::from_string(body.to_string()).with_header(json_header);
    let _ = req.respond(resp);
}

fn tool_defs() -> Value {
    json!([
        { "name": "whoami", "description": "返回自己的身份 {agentId, role, roleName, workspace}",
          "inputSchema": { "type": "object", "properties": {} } },
        { "name": "list_agents", "description": "列出团队所有 agent 及其角色",
          "inputSchema": { "type": "object", "properties": {} } },
        { "name": "send_message", "description": "给某个 agent(按 agentId 或角色名)投递一条消息",
          "inputSchema": { "type": "object",
            "properties": { "to": {"type":"string"}, "content": {"type":"string"}, "type": {"type":"string"} },
            "required": ["to", "content"] } },
        { "name": "read_inbox", "description": "取走自己收件箱里的全部未读消息",
          "inputSchema": { "type": "object", "properties": {} } },
        { "name": "await_next", "description": "挂起待对接：声明本回合做完、进入等待；有新消息会被唤醒",
          "inputSchema": { "type": "object", "properties": { "note": {"type":"string"} } } },
        { "name": "update_status", "description": "主动上报自己的状态(working/idle/waiting 等)",
          "inputSchema": { "type": "object",
            "properties": { "state": {"type":"string"}, "note": {"type":"string"} },
            "required": ["state"] } },
        { "name": "assign_task", "description": "[Lead] 给某 worker(按 agentId 或角色名)派任务、定文件范围，并唤醒它",
          "inputSchema": { "type": "object",
            "properties": { "workerId": {"type":"string"}, "task": {"type":"string"}, "fileScope": {"type":"string"} },
            "required": ["workerId", "task"] } },
        { "name": "report_result", "description": "[Worker] 回报任务结果(标记完成、唤醒派活的 Lead)",
          "inputSchema": { "type": "object",
            "properties": { "taskId": {"type":"string"}, "summary": {"type":"string"}, "artifacts": {"type":"string"} },
            "required": ["taskId", "summary"] } },
        { "name": "broadcast", "description": "[Lead] 给团队其余所有 agent 群发一条消息并唤醒",
          "inputSchema": { "type": "object", "properties": { "content": {"type":"string"} }, "required": ["content"] } },
        { "name": "list_tasks", "description": "查看任务板(全部任务及状态)",
          "inputSchema": { "type": "object", "properties": {} } },
        { "name": "write_shared", "description": "写共享黑板(团队公共结论/总目标等)",
          "inputSchema": { "type": "object",
            "properties": { "key": {"type":"string"}, "value": {"type":"string"} }, "required": ["key", "value"] } },
        { "name": "read_shared", "description": "读共享黑板某个 key",
          "inputSchema": { "type": "object", "properties": { "key": {"type":"string"} }, "required": ["key"] } },
        { "name": "claim_files", "description": "[Worker] 改文件前登记归属(占用这些路径)；被他人占用的会在 conflicts 返回",
          "inputSchema": { "type": "object",
            "properties": { "paths": {"type":"array","items":{"type":"string"}} }, "required": ["paths"] } },
        { "name": "release_files", "description": "释放自己占用的文件路径(完成后调用)",
          "inputSchema": { "type": "object",
            "properties": { "paths": {"type":"array","items":{"type":"string"}} }, "required": ["paths"] } },
        { "name": "list_claims", "description": "查看当前文件归属登记(路径→占用者)",
          "inputSchema": { "type": "object", "properties": {} } }
    ])
}

/// 启动 broker：绑定 127.0.0.1 随机端口，开后台线程跑请求循环；返回句柄。
pub fn start() -> Arc<Broker> {
    let server = Server::http("127.0.0.1:0").expect("MCP broker 绑定失败");
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(0);
    let broker = Arc::new(Broker {
        port,
        store: Mutex::new(Store::default()),
        app: Mutex::new(None),
    });
    let b = broker.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            b.handle(req);
        }
    });
    broker
}
