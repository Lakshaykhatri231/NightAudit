import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

// Every URL the app links to must reach a real page, not fall through to the root (404).
describe("App routing", () => {
  it.each(["/", "/hotels/harbourlight", "/reports/pinecrest/1", "/review", "/audit", "/data/pinecrest"])("matches a page for %s", (url) => {
    const router = createRouter({ routeTree });
    expect(router.matchRoutes(url).at(-1)?.routeId).not.toBe(rootRouteId);
  });
});
