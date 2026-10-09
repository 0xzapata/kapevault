// End-to-end checks for Lie Keeper: security questions in the form (add, remove,
// Invent), answers masked on the detail with reveal and copy, search by question never by answer, the
// answers carried through an edit, and Hotline mode (big answer, phonetic spelling, Read aloud only
// with a local voice, next question, Escape). Part of npm run e2e. Throwaway vault, mock names only.
// Page screenshots (light + dark) in %TEMP%\kapevault-e2e-v2.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHarness, shows, gone, clip, waitFor } = require("./e2e-harness.cjs");

const SHOTS = path.join(os.tmpdir(), "kapevault-e2e-v2");
fs.mkdirSync(SHOTS, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-lies-"));
const { check, launch, report } = createHarness();
const MASTER = "mock kettle harbor pass orbit gazelle";
const TYPED = "Zanzibar Lane 12";
const INVENTED = /^[a-z]+ [a-z]+ [1-9][0-9]$/;

(async () => {
  const { app, page, errors } = await launch({ KAPEVAULT_DATA_DIR: dataDir });
  const dialog = page.getByRole("dialog");
  const aside = page.locator("aside[aria-label='Vault navigation']");
  const search = aside.locator("[data-search]");
  const card = page.locator("section[aria-label='Security questions']");
  const theme = (t) => page.evaluate((name) => window.kapevault.setSettings({ theme: name }), t).then(() => page.waitForTimeout(400));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await theme("dark");
    await page.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
    await theme("classic");
  };

  await page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await page.getByPlaceholder("Confirm master password").fill(MASTER);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.evaluate(async () => {
    const b = window.kapevault;
    const spaceId = (await b.view()).spaces[0].id;
    await b.saveEntry({ spaceId, tags: [], favorite: false, notes: "", kind: "login", title: "Mock Bank", username: "mock.user", password: "Mock-Bank-Pass-72!x", url: "https://bank.example.com" });
  });
  await page.locator("section li", { hasText: "Mock Bank" }).click();
  check("a login without questions has no questions card", !(await card.isVisible()));

  // ---- The form: add, invent, type, remove
  await page.getByRole("button", { name: "Edit" }).click();
  check("the form has a Security questions group", await shows(dialog.getByText("Security questions", { exact: true })));
  check("it says the answer does not need to be true", await shows(dialog.getByText("Answers don't need to be true - KAPEVault remembers them.")));
  await dialog.getByRole("button", { name: "Add question" }).click();
  await dialog.getByRole("textbox", { name: "Question 1", exact: true }).fill("Mock first pet?");
  await dialog.getByRole("button", { name: "Invent answer 1" }).click();
  const answer1 = dialog.getByLabel("Answer 1", { exact: true });
  const invented = await answer1.inputValue();
  check("Invent fills a made-up answer: two words and a number", INVENTED.test(invented), invented);
  check("and shows it, so it can be read", (await answer1.getAttribute("type")) === "text");
  await dialog.getByRole("button", { name: "Invent answer 1" }).click();
  const inventedAgain = await answer1.inputValue();
  check("Invent again gives a different one", INVENTED.test(inventedAgain) && inventedAgain !== invented);
  await dialog.getByRole("button", { name: "Add question" }).click();
  await dialog.getByRole("textbox", { name: "Question 2", exact: true }).fill("Mock street you grew up on?");
  await dialog.getByLabel("Answer 2", { exact: true }).fill(TYPED);
  check("a typed answer is masked", (await dialog.getByLabel("Answer 2", { exact: true }).getAttribute("type")) === "password");
  await dialog.getByRole("button", { name: "Show answer 2" }).click();
  check("Show answer unmasks it", (await dialog.getByLabel("Answer 2", { exact: true }).getAttribute("type")) === "text");
  await dialog.getByRole("button", { name: "Add question" }).click();
  check("a third row appears", await shows(dialog.getByRole("textbox", { name: "Question 3", exact: true })));
  await shot("questions-form");
  await dialog.getByRole("button", { name: "Remove question 3" }).click();
  check("Remove takes the row out", await gone(dialog.getByRole("textbox", { name: "Question 3", exact: true })));
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);

  // ---- The detail: questions plain, answers masked, reveal one, copy one
  check("the detail lists both questions", (await shows(card.getByText("Mock first pet?"))) && (await shows(card.getByText("Mock street you grew up on?"))));
  const answersInPage = async () => {
    const html = await page.content();
    return [inventedAgain, TYPED].filter((a) => html.includes(a));
  };
  check("no answer is in the page before Reveal", (await answersInPage()).length === 0);
  check("the page view carries questions and hasAnswer only", await page.evaluate(async (answers) => {
    const text = JSON.stringify(await window.kapevault.view());
    return answers.every((a) => !text.includes(a)) && text.includes('"hasAnswer":true');
  }, [inventedAgain, TYPED]));
  await card.getByRole("button", { name: "Reveal answer 1" }).click();
  check("Reveal shows that answer only", (await shows(card.getByText(inventedAgain))) && !(await page.content()).includes(TYPED));
  await card.getByRole("button", { name: "Hide answer 1" }).click();
  check("Hide takes it out again", (await answersInPage()).length === 0);
  await card.getByRole("button", { name: "Copy answer 2 (clears in 30s)" }).click();
  check("Copy puts that answer on the clipboard", await waitFor(async () => (await clip(app)) === TYPED));
  check("a toast says it clears", await shows(page.getByRole("status").filter({ hasText: "Answer copied - clears in 30s" })));
  await shot("questions-card");

  // ---- Search: by question, never by answer
  await search.fill("first pet");
  check("search finds a login by its question", await shows(page.locator("section li", { hasText: "Mock Bank" })));
  await search.fill("zanzibar");
  check("search never matches an answer", await gone(page.locator("section li", { hasText: "Mock Bank" })));
  await search.fill("");
  await page.locator("section li", { hasText: "Mock Bank" }).click();

  // ---- An edit keeps the answers (loaded into the form, and carried when a question is reworded)
  await page.getByRole("button", { name: "Edit" }).click();
  check("editing does not load the answers", (await dialog.getByLabel("Answer 2", { exact: true }).inputValue()) === "" && !(await page.content()).includes(TYPED));
  await dialog.getByRole("button", { name: "Show answer 2" }).click();
  check("Show loads that one answer", await waitFor(async () => (await dialog.getByLabel("Answer 2", { exact: true }).inputValue()) === TYPED) && !(await page.content()).includes(inventedAgain));
  await dialog.getByRole("textbox", { name: "Question 1", exact: true }).fill("Mock name of first pet?");
  await dialog.getByRole("button", { name: "Save" }).click();
  await gone(dialog);
  const stored = await page.evaluate(async () => {
    const b = window.kapevault;
    const id = (await b.view()).entries.find((e) => e.title === "Mock Bank").id;
    return [await b.getSecret(id, "answer", 0), await b.getSecret(id, "answer", 1)];
  });
  check("a reworded question keeps its answer", stored[0] === inventedAgain && stored[1] === TYPED, JSON.stringify(stored));

  // ---- Hotline mode
  const hotline = page.getByRole("dialog", { name: "Phone call view" });
  await card.getByRole("button", { name: "Phone call view, question 1" }).click();
  check("Hotline mode opens full-window", await shows(hotline));
  check("with the question and the answer in large type", (await shows(hotline.getByText("Mock name of first pet?"))) && (await waitFor(async () => (await hotline.locator("[data-hotline-answer]").innerText()) === inventedAgain)));
  const spelled = hotline.getByRole("list", { name: "Spelled out" }).locator("li");
  const first = inventedAgain[0].toUpperCase();
  check("the answer is spelled phonetically", (await spelled.count()) === inventedAgain.length && (await spelled.first().getAttribute("aria-label")).startsWith(`${first} as in `));
  check("spaces are called out", await shows(hotline.locator("li[aria-label='space']")));
  const digits = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  check("digits are words", (await spelled.last().getAttribute("aria-label")) === digits[Number(inventedAgain.at(-1))]);
  const hasVoice = await page.evaluate(() => speechSynthesis.getVoices().some((v) => v.localService));
  const readAloud = hotline.getByRole("button", { name: "Read aloud" });
  check(`Read aloud shows only with a local voice (local voice here: ${hasVoice})`, (await readAloud.isVisible()) === hasVoice);
  if (hasVoice) {
    await readAloud.click();
    check("Read aloud turns into Stop while speaking", await shows(hotline.getByRole("button", { name: "Stop" })));
    await hotline.getByRole("button", { name: "Stop" }).click();
  }
  await shot("questions-hotline");
  await hotline.getByRole("button", { name: "Next question" }).click();
  check("Next question moves to question 2", (await shows(hotline.getByText("Question 2 of 2"))) && (await shows(hotline.locator("[data-hotline-answer]", { hasText: TYPED }))));
  check("capitals are called out", await shows(hotline.locator("li[aria-label='capital Z as in Zulu']")));
  const focusInside = () => hotline.evaluate((d) => d.contains(document.activeElement));
  check("at the last question the arrow keeps the focus", await hotline.getByRole("button", { name: "Next question" }).evaluate((b) => b === document.activeElement));
  let inside = true;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    inside = inside && (await focusInside());
  }
  check("Tab goes round inside the phone call view", inside);
  await hotline.getByRole("button", { name: "Done" }).focus();
  await page.keyboard.press("Shift+Tab");
  check("and Shift+Tab from Done stays inside too", await focusInside());
  await page.keyboard.press("Escape");
  check("Escape closes Hotline mode", await gone(hotline));
  check("focus goes back to the button that opened it", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Phone call view, question 1"));
  check("and the answer leaves the page with it", (await answersInPage()).length === 0);
  await card.getByRole("button", { name: "Phone call view, question 2" }).click();
  await hotline.getByRole("button", { name: "Done" }).click();
  check("Done closes it too", await gone(hotline));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = report() ? 0 : 1;
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
