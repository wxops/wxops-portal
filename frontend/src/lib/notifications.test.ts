import { beforeEach, describe, expect, it } from "vitest";
import { addNotification, clearAll, getAll, getUnreadCount, markAllRead } from "./notifications";

beforeEach(() => {
  sessionStorage.clear();
});

describe("notifications store", () => {
  it("starts empty", () => {
    expect(getAll()).toEqual([]);
    expect(getUnreadCount()).toBe(0);
  });

  it("addNotification prepends an unread entry with an id and timestamp", () => {
    addNotification({ type: "scaffold_created", title: "rocket-api created" });
    const all = getAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("rocket-api created");
    expect(all[0].read).toBe(false);
    expect(typeof all[0].id).toBe("string");
    expect(all[0].id.length).toBeGreaterThan(0);
    expect(typeof all[0].at).toBe("number");
  });

  it("newest notification is first", () => {
    addNotification({ type: "pr_opened", title: "first" });
    addNotification({ type: "pr_merged", title: "second" });
    expect(getAll()[0].title).toBe("second");
    expect(getAll()[1].title).toBe("first");
  });

  it("caps the stored list at 50 entries", () => {
    for (let i = 0; i < 55; i++) {
      addNotification({ type: "pr_opened", title: `n${i}` });
    }
    expect(getAll()).toHaveLength(50);
    expect(getAll()[0].title).toBe("n54");
  });

  it("getUnreadCount reflects only unread entries", () => {
    addNotification({ type: "pr_opened", title: "a" });
    addNotification({ type: "pr_opened", title: "b" });
    expect(getUnreadCount()).toBe(2);
  });

  it("markAllRead flips every entry to read and zeroes the unread count", () => {
    addNotification({ type: "pr_opened", title: "a" });
    addNotification({ type: "pr_opened", title: "b" });
    markAllRead();
    expect(getUnreadCount()).toBe(0);
    expect(getAll().every((n) => n.read)).toBe(true);
  });

  it("clearAll empties the store", () => {
    addNotification({ type: "pr_opened", title: "a" });
    clearAll();
    expect(getAll()).toEqual([]);
  });
});
