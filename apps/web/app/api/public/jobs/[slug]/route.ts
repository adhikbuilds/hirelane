import { createJobDetailHandler, optionsResponse } from "../../_lib/handlers";

export const dynamic = "force-dynamic";

export const GET = createJobDetailHandler();
export const OPTIONS = () => optionsResponse();
