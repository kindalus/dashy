import { pages } from "virtual:dashy-pages";
import { hydrate } from "@solidjs/web";
import { App, type AppProps } from "./app";
import "./styles.css";
// Project themes come after the engine's, so they can override their base theme.
import "virtual:dashy-themes";
const payload = document.getElementById("dashy-data");
if (!payload?.textContent) throw new Error("Missing dashboard bootstrap data");
const props = JSON.parse(payload.textContent) as AppProps;
const Page = props.page ? (await pages[props.page.id]!.load()).default : undefined;
hydrate(() => <App {...props} Page={Page} />, document.getElementById("app")!);
