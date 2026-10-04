// Entry point (index.html loads this). Base styles load first so component styles build on them.
import "./ui/styles/tokens.css";
import "./ui/styles/base.css";
import { showStartupError, startApp } from "./app/App";

startApp().catch(showStartupError);
