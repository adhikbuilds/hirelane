import { createJobsHandler, optionsResponse } from "../_lib/handlers";

export const dynamic = "force-dynamic";

export const GET = createJobsHandler();
export const OPTIONS = () => optionsResponse();
