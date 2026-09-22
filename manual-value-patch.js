/** Gatherer manual check value patch for Foundry VTT v14 / D&D5e. */
Hooks.once("ready", () => {
  const GathererSheet = globalThis.gatherer;
  if (!GathererSheet?.prototype?._onGather) {
    console.error("Gatherer Manual Value | GathererSheet._onGather not found");
    return;
  }

  const originalOnGather = GathererSheet.prototype._onGather;

  GathererSheet.prototype._onGather = async function(consumeDraw = true, harvestActor = null, gatheringActor = null, event = null) {
    // Only replace the D&D5e skill/ability check. Other Gatherer modes keep their original behaviour.
    if (!(this.SYSTEMABIL && this.supportedSystem && this.DC)) {
      return originalOnGather.call(this, consumeDraw, harvestActor, gatheringActor, event);
    }

    const actor = gatheringActor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor) return ui.notifications.error(game.i18n.localize("gatherer.sheet.err.noActor"));

    const ability = game.dnd5e?.config?.abilities?.[this.SYSTEMABIL];
    const skill = game.dnd5e?.config?.skills?.[this.SYSTEMABIL];
    const checkName = ability?.label ?? skill?.label ?? this.SYSTEMABIL;

    const fd = await foundry.applications.api.DialogV2.input({
      window: { title: `Сбор — ${checkName}` },
      content: `
        <div class="form-group" style="padding:8px 4px;">
          <label style="font-weight:700;">Значение проверки</label>
          <div class="form-fields">
            <input name="gatherValue" type="number" step="1" value="10" autofocus
                   style="font-size:20px;text-align:center;font-weight:700;">
          </div>
        </div>`,
      ok: { label: "СБОР", icon: "fa-solid fa-leaf" },
      rejectClose: false,
      modal: true
    });

    if (!fd) return;
    const manualValue = Number(fd.gatherValue);
    if (!Number.isFinite(manualValue)) return ui.notifications.warn("Введите числовое значение проверки.");

    // The original Gatherer workflow expects actor.rollSkill / rollAbilityCheck to return
    // an array whose first roll has .total. Temporarily provide exactly that result so
    // Gatherer keeps all its DC/table/loot logic, but D&D5e never opens its dice dialog.
    const ownSkill = Object.getOwnPropertyDescriptor(actor, "rollSkill");
    const ownAbility = Object.getOwnPropertyDescriptor(actor, "rollAbilityCheck");

    Object.defineProperty(actor, "rollSkill", {
      configurable: true,
      value: async () => [{ total: manualValue }]
    });
    Object.defineProperty(actor, "rollAbilityCheck", {
      configurable: true,
      value: async () => [{ total: manualValue }]
    });

    try {
      return await originalOnGather.call(this, consumeDraw, harvestActor, gatheringActor, event);
    } finally {
      if (ownSkill) Object.defineProperty(actor, "rollSkill", ownSkill);
      else delete actor.rollSkill;
      if (ownAbility) Object.defineProperty(actor, "rollAbilityCheck", ownAbility);
      else delete actor.rollAbilityCheck;
    }
  };

  console.log("Gatherer Manual Value | Active: skill/ability dice dialog replaced with manual value input.");
});
