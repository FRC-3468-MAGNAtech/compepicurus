import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// P25: member profiles in a real browser, on the fixture page (/e2e/profiles): the real profile screen, header, activity sections and Settings editor on fixed data,
// with no login. (What the database lets each person read and write is proved by the emulator rules tests, not here.) Screenshots go to e2e/screenshots/ (not committed).

const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function open(page: Page, query = "") {
  await page.goto(`/e2e/profiles${query}`);
  await page.waitForFunction(() => Array.isArray(window.__cleared) || Array.isArray(window.__saves)); // hydrated
}

/** Nothing sticks out sideways: the page is as wide as the screen. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const saves = (page: Page) => page.evaluate(() => window.__saves ?? []);

test.describe("a public profile, seen by a teammate", () => {
  test("shows the header, accuracy, practice, events, target and achievements", async ({ page }, info) => {
    await open(page, "?viewer=teammate");
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("profile-name")).toHaveText("Ada L.");
    await expect(page.getByTestId("profile-header")).toContainText("Account name: Ada Lovelace");
    await expect(page.getByTestId("profile-pronouns")).toHaveText("she/her");
    await expect(page.getByTestId("profile-bio")).toContainText("Counts everything twice.");
    await expect(page.getByTestId("profile-bio")).toContainText("Loves a clean auto.");
    await expect(page.getByTestId("profile-header")).toContainText("Match Scout");
    await expect(page.getByTestId("profile-header")).toContainText("Pit Scout");
    await expect(page.getByTestId("profile-joined")).toContainText("2025");
    await expect(page.getByTestId("profile-last-active")).toHaveText("Last active 3 hours ago");
    // a teammate gets no edit or preview controls and no moderation button
    await expect(page.getByTestId("edit-profile")).toHaveCount(0);
    await expect(page.getByTestId("view-as-others")).toHaveCount(0);
    await expect(page.getByTestId("clear-profile-text")).toHaveCount(0);

    // accuracy: the same engine as Scout Accuracy (the excluded 70% is left out of Trial's average)
    const trial = page.getByTestId("profile-accuracy-trial");
    await expect(trial).toContainText("Trial");
    await expect(trial).toContainText("95%"); // (88+94+100+96)/4 = 94.5
    await expect(trial).toContainText("Excellent");
    await expect(trial).toContainText("#1");
    await expect(trial).toContainText("5 sessions");
    await expect(page.getByTestId("profile-accuracy-competitive")).toContainText("91%");
    await expect(page.getByTestId("profile-accuracy-real-event")).toContainText("Real Event");

    // practice: the last five sessions, with their platform
    await expect(page.getByTestId("profile-session-count")).toContainText("6");
    await expect(page.getByTestId("profile-streak")).toContainText("5");
    await expect(page.getByTestId("profile-streak")).toContainText("days practice streak");
    const sessions = page.getByTestId("profile-recent-sessions").locator("li");
    await expect(sessions).toHaveCount(5);
    await expect(sessions.first()).toContainText("Excluded");
    await expect(page.getByTestId("profile-recent-sessions").getByText("Mobile")).toHaveCount(2);
    await expect(page.getByTestId("profile-recent-sessions").getByText("PC", { exact: true })).toHaveCount(3);

    // events: attended, entries per event, target completion at the current event
    const events = page.getByTestId("profile-events").locator("li");
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText("Bonney Lake Qualifier");
    await expect(events.nth(0)).toContainText("3 entries");
    await expect(events.nth(1)).toContainText("1 entry");
    await expect(events.nth(2)).toContainText("0 entries");
    const target = page.getByTestId("profile-target");
    await expect(target).toContainText("Target at Bonney Lake Qualifier");
    await expect(target).toContainText("3 of 6 · 50%");
    await expect(target.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    // achievements: computed from one config; earned ones lit, the rest dimmed
    for (const id of ["first-session", "perfect-session", "excellent", "streak", "event-veteran", "perfect-alliance"]) await expect(page.getByTestId(`badge-${id}`)).toHaveAttribute("data-earned", "true");
    for (const id of ["ten-sessions", "fifty-sessions"]) await expect(page.getByTestId(`badge-${id}`)).toHaveAttribute("data-earned", "false");

    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/profile-public-${info.project.name}.png`, fullPage: true });
  });

  test("has no layout shift between the loading skeleton and the loaded profile's header", async ({ page }) => {
    await open(page, "?viewer=teammate&loading=1");
    await expect(page.getByTestId("profile-activity-skeleton")).toBeVisible();
    await expect(page.getByTestId("profile-activity")).toHaveCount(0);
    const before = (await page.getByTestId("profile-header").boundingBox())!;
    const skeleton = (await page.getByTestId("profile-activity-skeleton").boundingBox())!;
    expect(skeleton.y).toBeGreaterThan(before.y + before.height - 1);
    await open(page, "?viewer=teammate");
    await expect(page.getByTestId("profile-activity")).toBeVisible();
    const after = (await page.getByTestId("profile-header").boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(8); // "Last active" fills the line the skeleton held
  });

  test("a member with nothing yet gets empty states, not blanks", async ({ page }) => {
    await open(page, "?viewer=teammate&empty=1&bio=none");
    await expect(page.getByTestId("profile-accuracy-trial")).toContainText("No Trial sessions yet.");
    await expect(page.getByTestId("profile-accuracy-competitive")).toContainText("No Competitive sessions yet.");
    await expect(page.getByTestId("profile-accuracy-real-event")).toContainText("No Real Event entries yet.");
    await expect(page.getByTestId("profile-no-sessions")).toBeVisible();
    await expect(page.getByTestId("profile-streak")).toContainText("0");
    await expect(page.getByTestId("profile-no-events")).toBeVisible();
    await expect(page.getByTestId("profile-target")).toHaveCount(0);
    await expect(page.getByTestId("profile-no-badges")).toBeVisible();
    await expect(page.getByTestId("profile-last-active")).toHaveText("No activity yet");
    await expect(page.getByTestId("profile-bio")).toHaveCount(0);
    await expect(page.getByTestId("profile-pronouns")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("a private profile", () => {
  test("a teammate sees only picture, name, primary role and “This profile is private” — nothing else is on the page", async ({ page }, info) => {
    await open(page, "?viewer=teammate&private=1");
    const card = page.getByTestId("profile-limited");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Ada Lovelace"); // the account name; the display name lives in the profile they can't read
    await expect(card).toContainText("Match Scout");
    await expect(card).toContainText("This profile is private");
    for (const id of ["profile-header", "profile-bio", "profile-pronouns", "profile-activity", "profile-accuracy-trial", "profile-badges", "profile-events"]) await expect(page.getByTestId(id)).toHaveCount(0);
    const html = await page.content();
    for (const secret of ["Counts everything twice", "she/her", "Ada L.", "Pit Scout", "Bonney Lake"]) expect(html).not.toContain(secret);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/profile-private-${info.project.name}.png`, fullPage: true });
  });

  test("an admin, and the member themself, still see all of it", async ({ page }) => {
    await open(page, "?viewer=admin&private=1");
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("profile-bio")).toContainText("Counts everything twice.");
    await expect(page.getByTestId("profile-limited")).toHaveCount(0);

    await open(page, "?viewer=self&private=1");
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("profile-bio")).toContainText("Counts everything twice.");
    await expect(page.getByTestId("profile-limited")).toHaveCount(0);
  });
});

test.describe("your own profile", () => {
  test("has Edit and a “View as others see it” toggle that shows the limited card when you're private", async ({ page }) => {
    await open(page, "?viewer=self&private=1");
    await expect(page.getByTestId("edit-profile")).toBeVisible();
    await expect(page.getByTestId("edit-profile").locator("xpath=ancestor::a")).toHaveAttribute("href", "/account#privacy-profile");
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("preview-banner")).toHaveCount(0);

    await page.getByTestId("view-as-others").click();
    await expect(page.getByTestId("preview-banner")).toContainText("Your profile is private");
    await expect(page.getByTestId("profile-limited")).toBeVisible();
    await expect(page.getByTestId("profile-header")).toHaveCount(0);
    await expect(page.getByTestId("profile-bio")).toHaveCount(0);

    await page.getByTestId("view-as-others").click();
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("profile-limited")).toHaveCount(0);
  });

  test("FIX4: you always see your own full profile, private or not, even when the read itself was refused", async ({ page }) => {
    for (const q of ["?viewer=self", "?viewer=self&private=1", "?viewer=self&private=1&denied=1"]) {
      await open(page, q);
      await expect(page.getByTestId("profile-header")).toBeVisible();
      await expect(page.getByTestId("profile-limited")).toHaveCount(0);
    }
    await expect(page.getByTestId("own-profile-unreadable")).toBeVisible(); // only the refused read says so
    await open(page, "?viewer=self&private=1");
    await expect(page.getByTestId("own-profile-unreadable")).toHaveCount(0);
    // a teammate with a refused read still gets the limited card
    await open(page, "?viewer=teammate&private=1&denied=1");
    await expect(page.getByTestId("profile-limited")).toBeVisible();
  });

  test("a public profile previews as the full page, and your own empty bio invites you to write one", async ({ page }) => {
    await open(page, "?viewer=self&bio=none");
    await expect(page.getByTestId("profile-bio-empty")).toContainText("You haven't written a bio yet");
    await page.getByTestId("view-as-others").click();
    await expect(page.getByTestId("preview-banner")).toContainText("Your profile is public to your team");
    await expect(page.getByTestId("profile-header")).toBeVisible();
  });
});

test.describe("moderation", () => {
  test("an admin can clear the bio and pronouns (after confirming) and nothing else changes", async ({ page }) => {
    await open(page, "?viewer=admin");
    await expect(page.getByTestId("profile-bio")).toBeVisible();
    await page.getByTestId("clear-profile-text").click();
    await expect(page.getByRole("dialog")).toContainText("Clear Ada Lovelace's bio and pronouns?");
    await expect(page.getByRole("dialog")).toContainText("recorded in the audit log");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.__cleared)).toEqual([]);

    await page.getByTestId("clear-profile-text").click();
    await page.getByTestId("confirm-clear-profile-text").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("profile-bio")).toHaveCount(0);
    await expect(page.getByTestId("profile-pronouns")).toHaveCount(0);
    await expect(page.getByTestId("profile-name")).toHaveText("Ada L."); // the display name stays
    await expect(page.getByTestId("clear-profile-text")).toHaveCount(0); // nothing left to clear
    expect(await page.evaluate(() => window.__cleared)).toEqual(["ada"]);
  });

  test("a teammate who isn't an admin has no moderation button", async ({ page }) => {
    await open(page, "?viewer=teammate");
    await expect(page.getByTestId("profile-bio")).toBeVisible();
    await expect(page.getByTestId("clear-profile-text")).toHaveCount(0);
  });
});

test.describe("Settings > Privacy and profile", () => {
  test("a member picks a picture, writes plain text and chooses private; what is saved is sanitized", async ({ page }, info) => {
    await open(page, "?view=editor&saved=none&google=1");
    const form = page.getByTestId("privacy-profile");
    await expect(page.getByTestId("save-profile")).toBeDisabled(); // nothing changed yet
    await expect(page.getByTestId("avatar-picker").getByRole("radio", { name: "Google picture" })).toBeVisible();

    await page.getByRole("radio", { name: "Rocket" }).click();
    await expect(page.getByRole("radio", { name: "Rocket" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Initials" })).toHaveAttribute("aria-checked", "false");
    await form.getByLabel("Display name").fill("  Ada   L. ");
    await form.getByLabel("Pronouns (optional)").fill("she/her");
    await form.getByLabel("Bio").fill("Hello <b>team</b>\n\n\n\nsecond line");
    await expect(page.getByTestId("bio-count")).toContainText("/ 280");
    // FIX4: the visibility choice saves on its own, and doesn't wipe what is typed but not yet saved
    await page.getByTestId("visibility-private").click();
    await expect(page.getByTestId("visibility-private")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("visibility-saved")).toContainText("now private");
    await expect(form.getByLabel("Bio")).toHaveValue("Hello <b>team</b>\n\n\n\nsecond line");
    await expect(page.getByRole("radio", { name: "Rocket" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: `${SHOTS}/profile-editor-${info.project.name}.png`, fullPage: true });
    await page.getByTestId("save-profile").click();

    await expect(page.getByTestId("profile-saved")).toContainText("Saved");
    expect(await page.evaluate(() => window.__visibilitySaves)).toEqual(["private"]);
    expect(await saves(page)).toEqual([{ displayName: "Ada L.", pronouns: "she/her", bio: "Hello team\n\nsecond line", avatar: { type: "preset", value: "rocket" }, visibility: "private" }]);
    await expect(page.getByTestId("save-profile")).toBeDisabled(); // saved: nothing left to save
    await expectNoHorizontalScroll(page);
  });

  test("FIX4: a non-admin flips public -> private -> public, each choice saves at once, and a failed save puts the choice back and says so", async ({ page }) => {
    await open(page, "?view=editor&saved=public");
    await expect(page.getByTestId("visibility-public")).toBeEnabled();
    await expect(page.getByTestId("visibility-private")).toBeEnabled();
    await expect(page.getByTestId("admin-visibility-note")).toHaveCount(0);
    await page.getByTestId("visibility-private").click();
    await expect(page.getByTestId("visibility-saved")).toContainText("now private");
    await expect(page.getByTestId("visibility-private")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("visibility-public").click();
    await expect(page.getByTestId("visibility-saved")).toContainText("public to your team");
    await expect(page.getByTestId("visibility-public")).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => window.__visibilitySaves)).toEqual(["private", "public"]);
    await expect(page.getByTestId("save-profile")).toBeDisabled(); // nothing else changed

    await open(page, "?view=editor&saved=public&fail=1");
    await page.getByTestId("visibility-private").click();
    await expect(page.getByTestId("visibility-error")).toContainText("Couldn't change who can see your profile");
    await expect(page.getByTestId("visibility-public")).toHaveAttribute("aria-checked", "true"); // put back
  });

  test("the bio stops at 280 characters", async ({ page }) => {
    await open(page, "?view=editor&saved=public");
    const bio = page.getByTestId("privacy-profile").getByLabel("Bio");
    await bio.fill("x".repeat(400));
    await expect(bio).toHaveValue("x".repeat(280));
    await expect(page.getByTestId("bio-count")).toHaveText("280 / 280");
  });

  test("the Google picture is only offered to someone who signed in with Google", async ({ page }) => {
    await open(page, "?view=editor&saved=none");
    await expect(page.getByTestId("avatar-picker").getByRole("radio", { name: "Google picture" })).toHaveCount(0);
    await expect(page.getByTestId("avatar-picker").getByRole("radio", { name: "Initials" })).toBeVisible();
  });

  test("an admin's visibility toggle is disabled with an explanation, and saving keeps what they had", async ({ page }) => {
    await open(page, "?view=editor&admin=1&saved=private");
    await expect(page.getByTestId("visibility-public")).toBeDisabled();
    await expect(page.getByTestId("visibility-private")).toBeDisabled();
    await expect(page.getByTestId("visibility-public")).toHaveAttribute("aria-checked", "true"); // what applies
    await expect(page.getByTestId("admin-visibility-note")).toContainText("always visible to their team");
    await expect(page.getByTestId("admin-visibility-note")).toContainText("Your saved choice, Private, applies again if your role changes.");

    await page.getByTestId("privacy-profile").getByLabel("Bio").fill("Edited as an admin");
    await page.getByTestId("save-profile").click();
    await expect(page.getByTestId("profile-saved")).toContainText("Saved");
    const [saved] = await saves(page);
    expect(saved.bio).toBe("Edited as an admin");
    expect(saved.visibility).toBe("private"); // unchanged: it comes back if they are demoted
  });

  test("states what private does and doesn't do", async ({ page }) => {
    await open(page, "?view=editor&saved=none");
    const limits = page.getByTestId("privacy-limits");
    await expect(limits).toContainText("hides your profile page and the text on it");
    await expect(limits).toContainText("doesn't hide the scouting your team already shares");
    await expect(limits).toContainText("Admins can always see your profile");
  });

  test("a failed save says so and keeps what was typed", async ({ page }) => {
    await open(page, "?view=editor&saved=public&fail=1");
    await page.getByTestId("privacy-profile").getByLabel("Bio").fill("Still here");
    await page.getByTestId("save-profile").click();
    await expect(page.getByTestId("profile-save-error")).toContainText("Couldn't save your profile");
    await expect(page.getByTestId("privacy-profile").getByLabel("Bio")).toHaveValue("Still here");
    await expect(page.getByTestId("save-profile")).toBeEnabled();
  });
});

test.describe("themes", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`readable in ${scheme} mode (screenshots)`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "?viewer=teammate");
      await expect(page.getByTestId("profile-activity")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/profile-${scheme}-${info.project.name}.png`, fullPage: true });
      await expectNoHorizontalScroll(page);
    });
  }
});
