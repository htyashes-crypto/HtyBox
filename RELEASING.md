# 发布与自更新（Release Runbook）

HtyBox 用 Tauri updater 插件做自更新：App 启动时拉取 GitHub Releases 上的 `latest.json`，发现更高版本就弹窗（更新日志 + 跳过 / 立刻更新）。本文是**每次发新版的操作手册**。

## 一次性前提（已就绪，勿重复做）

- **签名密钥**：`%USERPROFILE%\.tauri\htybox.key`（私钥，无密码）+ `.key.pub`（公钥）。
  - ⚠️ **私钥务必离线备份**：丢失 = 再也无法签名更新，所有已安装用户将永久卡死在旧版。**切勿提交进仓库**。
  - 公钥已写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`，**不要改**（改了 = 旧版校验失败）。
- **更新端点**：`src-tauri/tauri.conf.json` → `plugins.updater.endpoints` =
  `https://github.com/htyashes-crypto/HtyBox/releases/latest/download/latest.json`
  （仓库公开、免鉴权；GitHub 的 `latest` 自动指向最新的非 draft / 非 prerelease 发布）。
- **`bundle.createUpdaterArtifacts = true`** 已开（构建时生成 `.sig` 签名）。
- 发布走 GitHub API，凭据取环境变量 `GH_TOKEN`（需 repo / contents:write 权限）。

## 发新版步骤

> 下面以发 `0.1.1` 为例，把 `X.Y.Z` 换成实际版本。命令在 **PowerShell**、仓库根 `HtyBox/` 下执行。

### 1. 改版本号（三处保持一致）

- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `package.json` → `version`

### 2. 签名构建（NSIS）

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\htybox.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build --bundles nsis
```

产物在 `src-tauri/target/release/bundle/nsis/`：

- `HtyBox_X.Y.Z_x64-setup.exe`（安装包）
- `HtyBox_X.Y.Z_x64-setup.exe.sig`（更新签名）

> 坑：bundler 只认 `TAURI_SIGNING_PRIVATE_KEY`（密钥**内容**），不认 `TAURI_SIGNING_PRIVATE_KEY_PATH`。

### 3. 发布 + 上传（GitHub API，自动生成 latest.json）

把 `$ver` 与 `$notes` 改好后整段执行：

```powershell
$ver   = "X.Y.Z"
$notes = @"
HtyBox vX.Y.Z

- 本次更新日志（markdown，会显示在更新弹窗里）
"@
$repo = "htyashes-crypto/HtyBox"
$nsis = "src-tauri/target/release/bundle/nsis"
$exe  = "$nsis/HtyBox_${ver}_x64-setup.exe"
$sig  = (Get-Content "$exe.sig" -Raw).Trim()
$headers = @{ Authorization="Bearer $($env:GH_TOKEN)"; Accept="application/vnd.github+json"; "X-GitHub-Api-Version"="2022-11-28"; "User-Agent"="HtyBox" }

# 建 release（tag 自动建在 main 最新提交上）
$relBody = @{ tag_name="v$ver"; target_commitish="main"; name="HtyBox v$ver"; body=$notes; draft=$false; prerelease=$false } | ConvertTo-Json -Depth 4
$rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($relBody)) -ContentType "application/json; charset=utf-8"
$up = ($rel.upload_url -replace '\{.*\}','')

# 生成 latest.json
$latest = [ordered]@{ version=$ver; notes=$notes; pub_date=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
  platforms=@{ "windows-x86_64"=@{ signature=$sig; url="https://github.com/$repo/releases/download/v$ver/HtyBox_${ver}_x64-setup.exe" } } } | ConvertTo-Json -Depth 6
Set-Content "$nsis/latest.json" $latest -Encoding utf8

# 上传 安装包 + latest.json
Invoke-RestMethod -Method Post -Uri ($up+"?name=HtyBox_${ver}_x64-setup.exe") -Headers $headers -InFile $exe -ContentType "application/octet-stream" | Out-Null
Invoke-RestMethod -Method Post -Uri ($up+"?name=latest.json") -Headers $headers -InFile "$nsis/latest.json" -ContentType "application/json" | Out-Null
"published: $($rel.html_url)"
```

### 4. 验证

```powershell
curl.exe -sL https://github.com/htyashes-crypto/HtyBox/releases/latest/download/latest.json
```

确认返回的 `version` 是新版、`signature` / `url` 正确；旧版 App 启动即应弹更新窗。
别忘了把版本号那次改动 `git commit` + `git push`。

## 排错

- **构建结尾报 “no private key”**：`TAURI_SIGNING_PRIVATE_KEY` 没设或被设成了路径 —— 必须是密钥**文件内容**。
- **App 不弹更新**：检查 latest.json 的 `version` 是否 > App 版本；`signature` 是否与该 installer 的 `.sig` 一致；`pubkey` 是否与签名私钥配对。
- **下载后校验失败**：多半是 `signature` 填错，或 installer 与 sig 不是同一次构建产物。
