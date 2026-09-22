const CURRENCY_KEYS = new Set(["pp", "gp", "ep", "sp", "cp"]);
const CURRENCY_LABELS = { pp: "Платина", gp: "Золото", ep: "Электрум", sp: "Серебро", cp: "Медь" };
const CURRENCY_ICONS = { pp: "platinum.png", gp: "gold.png", ep: "electrum.png", sp: "silver.png", cp: "copper.png" };

function getCurrencyKey(thing) {
  const item = thing?.item;
  if (!item) return null;
  const ItemClass = CONFIG.Item?.documentClass?.implementation;
  if (ItemClass && item instanceof ItemClass) return null;
  const key = String(item.name ?? item.text ?? "").trim().toLowerCase();
  return CURRENCY_KEYS.has(key) ? key : null;
}

// Currency rows remain normal RollTable text results. Gatherer already calculates
// their Quantity formula, so we only need to transfer that resolved quantity to
// the D&D5e actor currency fields.
Hooks.on("gathererGather", (gatherData) => {
  if (game.system.id !== "dnd5e") return;
  const actor = gatherData?.actor;
  const things = gatherData?.things;
  if (!actor || !Array.isArray(things)) return;

  const additions = {};
  for (const thing of things) {
    const key = getCurrencyKey(thing);
    if (!key) continue;
    const qty = Number(thing.quantity ?? 0);
    if (qty <= 0) continue;
    additions[key] = (additions[key] ?? 0) + qty;
  }

  if (!Object.keys(additions).length) return;

  const update = {};
  for (const [key, qty] of Object.entries(additions)) {
    const current = Number(foundry.utils.getProperty(actor, `system.currency.${key}`) ?? 0);
    update[`system.currency.${key}`] = current + qty;
  }

  actor.update(update).catch(err => console.error("Gatherer currency update failed", err));
});

// Custom chat renderer: keeps currency support and makes Gatherer loot messages
// visible only to all GMs and the user who performed the gathering action.
Hooks.once("init", () => {
  const GathererSheet = globalThis.gatherer;
  if (!GathererSheet?.prototype) return;

  // Use the same custom currency icons in the Gatherer preview for text
  // RollTable results named cp/sp/gp/ep/pp. The RollTable itself remains text.
  const originalGetGathererData = GathererSheet.prototype.getGathererData;
  if (originalGetGathererData && !GathererSheet.prototype.__gathererCurrencyPreviewPatched) {
    GathererSheet.prototype.getGathererData = async function (...args) {
      const data = await originalGetGathererData.apply(this, args);
      for (const result of (data?.weightedResults ?? [])) {
        const key = getCurrencyKey({ item: result.item });
        result.displayImg = key
          ? `modules/gatherer/icons/currency/${CURRENCY_ICONS[key]}`
          : (result.item?.img ?? "icons/svg/d20-grey.svg");
        // Never mutate result.item.name here. The same object is reused after Gather;
        // changing cp/sp/gp into Russian text made later currency detection fail.
        // Keep the raw RollTable key intact and expose a separate display name.
        result.displayName = key ? CURRENCY_LABELS[key] : (result.item?.name ?? "");
      }
      return data;
    };
    GathererSheet.prototype.__gathererCurrencyPreviewPatched = true;
  }

  GathererSheet.prototype.toChat = async function (things, actor) {
    const ItemClass = CONFIG.Item.documentClass.implementation;
    const onlyItemsAndCurrency = Array.isArray(things) && things.every(thing =>
      (thing.item instanceof ItemClass) || Boolean(getCurrencyKey(thing))
    );

    let content = `
      <strong>${actor.name} ${onlyItemsAndCurrency ? game.i18n.localize("gatherer.gathered") : game.i18n.localize("gatherer.found")}:</strong>
      <div class="table-draw">
      <ul class="table-results">`;

    for (const thing of things) {
      const key = getCurrencyKey(thing);
      if (key) {
        content += `<li class="table-result flexrow">
          <img class="result-image" src="modules/gatherer/icons/currency/${CURRENCY_ICONS[key]}">
          <div class="result-text" style="text-align:left;"><strong>${CURRENCY_LABELS[key]} X ${thing.quantity}</strong></div>
        </li>`;
      } else if (thing.item instanceof ItemClass) {
        content += `<li class="table-result flexrow">
          <img class="result-image" src="${thing.item.img}">
          <div class="result-text">@UUID[${thing.item.uuid}]{${thing.item.name} X ${thing.quantity}}</div>
        </li>`;
      } else {
        content += `<li class="table-result flexcol">
          <li class="table-result flexrow">
            <img class="result-image" src="${thing.item?.img ?? "icons/svg/d20-grey.svg"}">
            <div class="result-text"><strong>${thing.item?.name ?? ""}</strong></div>
          </li>
          <div class="result-text">${thing.item?.description ?? ""}</div>
        </li>`;
      }
    }

    content += `</ul></div>`;

    // All GMs + player owner(s) of the actor that performed the gathering.
    // Gatherer can execute the final chat creation on the GM client, so game.user
    // is not always the player who clicked Gather. Resolve the recipient from
    // the gathering actor instead.
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const looterUsers = game.users.filter(user => {
      if (user.isGM) return false;
      if (user.character?.id === actor.id) return true;
      return (actor.ownership?.[user.id] ?? 0) >= OWNER;
    });

    const whisper = [...new Set([
      ...game.users.filter(user => user.isGM).map(user => user.id),
      ...looterUsers.map(user => user.id)
    ])];

    return ChatMessage.create({
      content: await foundry.applications.ux.TextEditor.implementation.enrichHTML(content),
      speaker: { actor: actor.id },
      whisper
    });
  };
});
