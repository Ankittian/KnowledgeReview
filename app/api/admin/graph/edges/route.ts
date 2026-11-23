import { graphRoute } from "@/lib/kg/http";

export const GET = (req: Request) => graphRoute(req, "edges");
