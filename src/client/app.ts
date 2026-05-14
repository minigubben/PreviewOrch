import "./styles.css";

import { bindDashboard } from "./dashboard";
import { initPanelSelector } from "./panels";
import { startDeploymentsPolling } from "./refresh";

bindDashboard(document);
initPanelSelector();
startDeploymentsPolling();
