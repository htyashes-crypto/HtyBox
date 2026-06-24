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

#[derive(Default)]
struct Store {
    by_token: HashMap<String, AgentInfo>, // token -> 身份
    inbox: HashMap<String, Vec<InboxMsg>>, // agentId -> 未读
    seq: u64,
}

pub struct Broker {
    port: u16,
    store: Mutex<Store>,
}

impl Broker {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 注册一个 agent（开启团队/新建 agent 终端前调用）：token -> 身份。
    pub fn register(&self, token: String, info: AgentInfo) {
        let mut s = self.store.lock().unwrap();
        s.inbox.entry(info.agent_id.clone()).or_default();
        s.by_token.insert(token, info);
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
                let agents: Vec<&AgentInfo> = s.by_token.values().collect();
                Ok(json!({ "agents": agents }))
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
                let target = s
                    .by_token
                    .values()
                    .find(|i| i.agent_id == to || i.role_name == to)
                    .map(|i| i.agent_id.clone())
                    .ok_or((-32004, format!("找不到目标 agent: {to}")))?;
                s.seq += 1;
                let msg = InboxMsg {
                    from: caller.agent_id.clone(),
                    content: content.to_string(),
                    msg_type,
                    seq: s.seq,
                };
                s.inbox.entry(target.clone()).or_default().push(msg);
                Ok(json!({ "delivered": true, "to": target }))
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
    });
    let b = broker.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            b.handle(req);
        }
    });
    broker
}
