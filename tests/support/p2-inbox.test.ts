import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), supportNotification: vi.fn(), inboxFor: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authenticate: mocks.authenticate }));
vi.mock("@/lib/support/store", () => ({ supportNotification: mocks.supportNotification }));
vi.mock("@/lib/viewer/announcements", () => ({ inboxFor: mocks.inboxFor }));
import { GET } from "@/app/api/me/inbox/route";
const request = () => new NextRequest("http://localhost/api/me/inbox");
beforeEach(() => vi.resetAllMocks());
it("rejects unauthenticated requests without loading private data", async () => {
  mocks.authenticate.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.supportNotification).not.toHaveBeenCalled();
  expect(mocks.inboxFor).not.toHaveBeenCalled();
});
it("authenticates once and returns both private notification summaries", async () => {
  mocks.authenticate.mockResolvedValue({ userId: "viewer" });
  mocks.supportNotification.mockResolvedValue({ count: 2, latest: null });
  mocks.inboxFor.mockResolvedValue({ unread: 3, items: [{ id: "notice", body: "Deferred body", priority: "inbox" }] });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  expect(mocks.supportNotification).toHaveBeenCalledWith("viewer");
  expect(mocks.inboxFor).toHaveBeenCalledWith("viewer");
  expect(await response.json()).toMatchObject({ unreadSupport: { count: 2 }, announcements: { unread: 3, items: [{ body: "", bodyLoaded: false }] } });
});
