import { hydrate } from "@solidjs/web";
import { App, type AppProps } from "./app";
import "./styles.css";
const payload = document.getElementById("dashy-data");
if (!payload?.textContent) throw new Error("Missing dashboard bootstrap data");
const props = JSON.parse(payload.textContent) as AppProps;
hydrate(() => <App {...props} />, document.getElementById("app")!);
