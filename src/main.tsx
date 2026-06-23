import ReactDOM from "react-dom/client";
import App from "./App";
import "allotment/dist/style.css";
import "./index.css";

// 刻意不用 React.StrictMode —— 它在 dev 下二次挂载 effect 会重复 spawn/kill PTY 子进程。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
