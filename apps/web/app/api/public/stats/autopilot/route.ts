import { optionsResponse } from "../../_lib/http";
import { createAutopilotHandler } from "./handler";

export const dynamic = "force-dynamic";

export const GET = createAutopilotHandler();
export const OPTIONS = () => optionsResponse();
