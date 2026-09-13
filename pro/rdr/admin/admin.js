/**
 * admin.js — the shop dashboard.
 *
 * Row-level security is what actually protects this data; the gate below is
 * only so a non-admin sees a sensible message instead of empty tables. The
 * service-role key must never appear here.
 */
(() => {
  const sb = window.RdrSupabase;
  const ORDER_STATUSES = ["new", "confirmed", "ready", "done", "cancelled"];
  const STATUS_LABELS = {
    new: "Nouvelle", confirmed: "Confirmée", ready: "Prête",
    done: "Terminée", cancelled: "Annulée",
  };
  const CATEGORIES = ["vin", "cremant", "champagne", "whisky", "gin", "rhum", "porto", "grappa", "divers"];
  const COLOURS = ["", "blanc", "rose", "rouge"];

  const el = (selector) => document.querySelector(selector);
  const statusHost = el("[data-status]");

  let countries = [];
  let producers = [];
  let products = [];

  function say(message, isError = false) {
    statusHost.textContent = message;
    statusHost.classList.toggle("admin-danger", isError);
  }

  function fail(context, error) {
    console.error(context, error);
    say(`${context} — ${error.message}`, true);
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  /** Never hand PostgREST a duplicate primary key. */
  function uniqueId(base, taken) {
    const root = base || "item";
    if (!taken.has(root)) return root;
    let suffix = 2;
    while (taken.has(`${root}-${suffix}`)) suffix += 1;
    return `${root}-${suffix}`;
  }

  function money(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("fr-LU", { style: "currency", currency: "EUR" }).format(value);
  }

  function makeTable(columns) {
    const table = document.createElement("table");
    table.className = "admin-table";
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    columns.forEach((label) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      row.appendChild(th);
    });
    head.appendChild(row);
    const body = document.createElement("tbody");
    table.append(head, body);
    return { table, body };
  }

  function cell(row, label, content) {
    const td = document.createElement("td");
    td.dataset.label = label;
    if (content instanceof Node) td.appendChild(content);
    else td.textContent = content ?? "";
    row.appendChild(td);
    return td;
  }

  function button(label, onClick, className = "link-button") {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.textContent = label;
    control.addEventListener("click", onClick);
    return control;
  }

  function confirmDelete(name) {
    return window.confirm(`Supprimer « ${name} » ? Cette action est définitive.`);
  }

  // ---------------------------------------------------------------- loading
  async function loadReferenceData() {
    [countries, producers, products] = await Promise.all([
      sb.select("rdr_countries", { select: "*", order: "sort_key.asc" }),
      sb.select("rdr_producers", { select: "*", order: "name.asc" }),
      sb.select("rdr_products", { select: "*", order: "name.asc" }),
    ]);
  }

  // ---------------------------------------------------------------- orders
  async function renderOrders(host) {
    host.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "admin-toolbar";
    const filter = document.createElement("select");
    filter.innerHTML = '<option value="">Tous les statuts</option>'
      + ORDER_STATUSES.map((s) => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("");
    toolbar.append(filter);
    host.appendChild(toolbar);

    const { table, body } = makeTable(["Référence", "Client", "Retrait/Livraison", "Total", "Statut", "Reçue le", ""]);
    host.appendChild(table);

    async function paint() {
      const params = { select: "*", order: "created_at.desc", limit: 200 };
      if (filter.value) params.status = `eq.${filter.value}`;
      let orders;
      try {
        orders = await sb.select("rdr_orders", params);
      } catch (error) {
        fail("Impossible de charger les commandes", error);
        return;
      }
      body.replaceChildren();
      if (orders.length === 0) {
        const row = document.createElement("tr");
        cell(row, "", "Aucune commande pour le moment.");
        body.appendChild(row);
        return;
      }
      orders.forEach((order) => {
        const row = document.createElement("tr");
        cell(row, "Référence", order.reference);
        cell(row, "Client", `${order.first_name} ${order.last_name} · ${order.email}`);
        cell(row, "Mode", order.fulfilment === "delivery"
          ? `Livraison — ${order.address || ""}, ${order.postcode || ""} ${order.locality || ""}`
          : "Retrait à la vinothèque");
        cell(row, "Total", money(order.items_total)).className = "num";
        const select = document.createElement("select");
        select.innerHTML = ORDER_STATUSES.map((s) =>
          `<option value="${s}"${s === order.status ? " selected" : ""}>${STATUS_LABELS[s]}</option>`).join("");
        select.addEventListener("change", async () => {
          try {
            await sb.update("rdr_orders", { id: `eq.${order.id}` }, { status: select.value });
            say(`Commande ${order.reference} : ${STATUS_LABELS[select.value]}.`);
          } catch (error) {
            fail("Statut non enregistré", error);
            select.value = order.status;
          }
        });
        cell(row, "Statut", select);
        cell(row, "Reçue le", new Date(order.created_at).toLocaleString("fr-LU"));
        cell(row, "", button("Voir les articles", async () => {
          try {
            const items = await sb.select("rdr_order_items", { select: "*", order_id: `eq.${order.id}` });
            window.alert(items.map((i) =>
              `${i.quantity} × ${i.product_name} (${i.format || "—"}) — ${money(i.line_total_eur)}`).join("\n")
              || "Aucun article.");
          } catch (error) {
            fail("Articles introuvables", error);
          }
        }));
        body.appendChild(row);
      });
    }

    filter.addEventListener("change", paint);
    await paint();
  }

  // -------------------------------------------------------------- products
  async function renderProducts(host) {
    host.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "admin-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Chercher un produit ou un producteur";
    search.setAttribute("aria-label", "Chercher");
    const onlyReview = document.createElement("label");
    const reviewBox = document.createElement("input");
    reviewBox.type = "checkbox";
    onlyReview.append(reviewBox, document.createTextNode(" À vérifier uniquement"));
    toolbar.append(search, onlyReview, button("Nouveau produit", () => editProduct(null), "button"));
    host.appendChild(toolbar);

    const { table, body } = makeTable(["Produit", "Producteur", "Format", "Prix", "Stock", "Actions"]);
    host.appendChild(table);

    function paint() {
      const term = slugify(search.value);
      const rows = products.filter((product) => {
        if (reviewBox.checked && !product.needs_review) return false;
        if (!term) return true;
        const producer = producers.find((p) => p.id === product.producer_id);
        return slugify(`${product.name} ${producer?.name || ""}`).includes(term);
      }).slice(0, 300);

      body.replaceChildren();
      rows.forEach((product) => {
        const row = document.createElement("tr");
        const nameCell = document.createElement("span");
        nameCell.textContent = product.name;
        if (product.needs_review) {
          const flag = document.createElement("span");
          flag.className = "badge-review";
          flag.textContent = " à vérifier";
          nameCell.appendChild(flag);
        }
        cell(row, "Produit", nameCell);
        cell(row, "Producteur", producers.find((p) => p.id === product.producer_id)?.name || "—");
        cell(row, "Format", product.format);
        cell(row, "Prix", product.price_on_request ? "sur demande" : money(product.price_eur)).className = "num";
        cell(row, "Stock", product.out_of_stock ? "Épuisé" : "En stock");

        const actions = document.createElement("div");
        actions.className = "row-actions";
        actions.append(button("Modifier", () => editProduct(product)));
        // The single most valuable action here: 333 products arrived flagged.
        if (product.needs_review) {
          actions.append(button("Nom vérifié", async () => {
            try {
              await sb.update("rdr_products", { id: `eq.${product.id}` }, { needs_review: false });
              product.needs_review = false;
              say(`« ${product.name} » marqué comme vérifié.`);
              paint();
            } catch (error) { fail("Mise à jour impossible", error); }
          }));
        }
        actions.append(button(product.out_of_stock ? "Remettre en stock" : "Marquer épuisé", async () => {
          try {
            const next = !product.out_of_stock;
            await sb.update("rdr_products", { id: `eq.${product.id}` }, { out_of_stock: next });
            product.out_of_stock = next;
            paint();
          } catch (error) { fail("Mise à jour impossible", error); }
        }));
        actions.append(button("Supprimer", async () => {
          if (!confirmDelete(product.name)) return;
          try {
            await sb.remove("rdr_products", { id: `eq.${product.id}` });
            products = products.filter((p) => p.id !== product.id);
            say(`« ${product.name} » supprimé.`);
            paint();
          } catch (error) { fail("Suppression impossible", error); }
        }));
        cell(row, "Actions", actions);
        body.appendChild(row);
      });

      const count = document.createElement("p");
      count.className = "admin-status";
      count.textContent = `${rows.length} produit(s) affiché(s) sur ${products.length}.`;
      if (host.lastElementChild?.classList.contains("admin-status")) host.lastElementChild.remove();
      host.appendChild(count);
    }

    search.addEventListener("input", paint);
    reviewBox.addEventListener("change", paint);
    paint();

    async function editProduct(existing) {
      const form = document.createElement("form");
      form.className = "admin-form";
      const isNew = !existing;
      const producerOptions = producers.map((p) =>
        `<option value="${p.id}"${existing?.producer_id === p.id ? " selected" : ""}>${p.name}</option>`).join("");
      form.innerHTML = `
        <label>Nom<input name="name" required value="${existing?.name?.replace(/"/g, "&quot;") || ""}"></label>
        <label>Producteur<select name="producer_id" required>${producerOptions}</select></label>
        <label>Catégorie<select name="category">${CATEGORIES.map((c) =>
          `<option value="${c}"${existing?.category === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
        <label>Couleur<select name="colour">${COLOURS.map((c) =>
          `<option value="${c}"${(existing?.colour || "") === c ? " selected" : ""}>${c || "—"}</option>`).join("")}</select></label>
        <label>Format<input name="format" required value="${existing?.format || "75 cl"}"></label>
        <label>Prix (€)<input name="price_eur" type="number" step="0.01" min="0" value="${existing?.price_eur ?? ""}"></label>
        <label><input name="price_on_request" type="checkbox"${existing?.price_on_request ? " checked" : ""}> Prix sur demande</label>
        <label><input name="out_of_stock" type="checkbox"${existing?.out_of_stock ? " checked" : ""}> Épuisé</label>
        <label>Note de dégustation (FR)<textarea name="tasting_note_fr" rows="2">${existing?.tasting_note_fr || ""}</textarea></label>
        <button class="button" type="submit">${isNew ? "Créer" : "Enregistrer"}</button>`;
      const dialog = document.createElement("section");
      dialog.className = "admin-panel";
      dialog.append(form);
      host.prepend(dialog);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const onRequest = data.get("price_on_request") === "on";
        const rawPrice = String(data.get("price_eur") || "").trim();
        if (!onRequest && rawPrice === "") { say("Indiquez un prix ou cochez « prix sur demande ».", true); return; }
        const payload = {
          name: String(data.get("name")).trim(),
          producer_id: data.get("producer_id"),
          category: data.get("category"),
          colour: data.get("colour") || null,
          format: String(data.get("format")).trim(),
          price_eur: onRequest ? null : Number(rawPrice),
          price_on_request: onRequest,
          out_of_stock: data.get("out_of_stock") === "on",
          tasting_note_fr: String(data.get("tasting_note_fr") || "").trim() || null,
        };
        try {
          if (isNew) {
            const taken = new Set(products.map((p) => p.id));
            payload.id = uniqueId(`${slugify(payload.producer_id)}-${slugify(payload.name)}-${slugify(payload.format)}`, taken);
            const [created] = await sb.insert("rdr_products", [payload]);
            products = [...products, created];
          } else {
            const [updated] = await sb.update("rdr_products", { id: `eq.${existing.id}` }, payload);
            products = products.map((p) => (p.id === existing.id ? updated : p));
          }
          dialog.remove();
          say(isNew ? "Produit créé." : "Produit enregistré.");
          paint();
        } catch (error) { fail("Enregistrement impossible", error); }
      });
    }
  }

  // ------------------------------------------------- producers & countries
  function simpleCrud({ host, table, rows, columns, toPayload, describe, formHtml, afterChange }) {
    host.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "admin-toolbar";
    toolbar.append(button("Nouveau", () => openForm(null), "button"));
    host.appendChild(toolbar);
    const { table: node, body } = makeTable([...columns.map((c) => c.label), "Actions"]);
    host.appendChild(node);

    function paint() {
      body.replaceChildren();
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        columns.forEach((column) => cell(tr, column.label, column.value(row)));
        const actions = document.createElement("div");
        actions.className = "row-actions";
        actions.append(button("Modifier", () => openForm(row)));
        actions.append(button("Supprimer", async () => {
          if (!confirmDelete(describe(row))) return;
          try {
            await sb.remove(table, { id: `eq.${row.id}` });
            const index = rows.findIndex((candidate) => candidate.id === row.id);
            if (index >= 0) rows.splice(index, 1);
            say("Supprimé.");
            paint();
            afterChange?.();
          } catch (error) { fail("Suppression impossible (des éléments liés existent peut-être)", error); }
        }));
        cell(tr, "Actions", actions);
        body.appendChild(tr);
      });
    }

    function openForm(existing) {
      const panel = document.createElement("section");
      panel.className = "admin-panel";
      const form = document.createElement("form");
      form.className = "admin-form";
      form.innerHTML = `${formHtml(existing)}<button class="button" type="submit">Enregistrer</button>`;
      panel.appendChild(form);
      host.prepend(panel);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = toPayload(new FormData(form));
        try {
          if (existing) {
            const [updated] = await sb.update(table, { id: `eq.${existing.id}` }, payload);
            const index = rows.findIndex((candidate) => candidate.id === existing.id);
            if (index >= 0) rows[index] = updated;
          } else {
            payload.id = uniqueId(slugify(payload.name || payload.title_fr), new Set(rows.map((r) => r.id)));
            const [created] = await sb.insert(table, [payload]);
            rows.push(created);
          }
          panel.remove();
          say("Enregistré.");
          paint();
          afterChange?.();
        } catch (error) { fail("Enregistrement impossible", error); }
      });
    }

    paint();
  }

  function renderProducers(host) {
    simpleCrud({
      host,
      table: "rdr_producers",
      rows: producers,
      describe: (row) => row.name,
      columns: [
        { label: "Nom", value: (r) => r.name },
        { label: "Pays", value: (r) => countries.find((c) => c.id === r.country_id)?.name_fr || "—" },
        { label: "Région", value: (r) => r.region || "—" },
      ],
      formHtml: (existing) => `
        <label>Nom<input name="name" required value="${existing?.name?.replace(/"/g, "&quot;") || ""}"></label>
        <label>Pays<select name="country_id"><option value="">—</option>${countries.map((c) =>
          `<option value="${c.id}"${existing?.country_id === c.id ? " selected" : ""}>${c.name_fr}</option>`).join("")}</select></label>
        <label>Région<input name="region" value="${existing?.region || ""}"></label>
        <label>Histoire (FR)<textarea name="story_fr" rows="3">${existing?.story_fr || ""}</textarea></label>`,
      toPayload: (data) => ({
        name: String(data.get("name")).trim(),
        country_id: data.get("country_id") || null,
        region: String(data.get("region") || "").trim() || null,
        story_fr: String(data.get("story_fr") || "").trim() || null,
      }),
    });
  }

  function renderCountries(host) {
    simpleCrud({
      host,
      table: "rdr_countries",
      rows: countries,
      describe: (row) => row.name_fr,
      columns: [
        { label: "Français", value: (r) => r.name_fr },
        { label: "Deutsch", value: (r) => r.name_de || "—" },
        { label: "English", value: (r) => r.name_en || "—" },
      ],
      formHtml: (existing) => `
        <label>Nom (FR)<input name="name_fr" required value="${existing?.name_fr || ""}"></label>
        <label>Nom (DE)<input name="name_de" value="${existing?.name_de || ""}"></label>
        <label>Nom (EN)<input name="name_en" value="${existing?.name_en || ""}"></label>`,
      toPayload: (data) => ({
        name: String(data.get("name_fr")).trim(),
        name_fr: String(data.get("name_fr")).trim(),
        name_de: String(data.get("name_de") || "").trim() || null,
        name_en: String(data.get("name_en") || "").trim() || null,
      }),
    });
  }

  // ------------------------------------------------------------ reductions
  async function renderReductions(host) {
    host.replaceChildren();
    let reductions = [];
    try {
      reductions = await sb.select("rdr_reductions", { select: "*" });
    } catch (error) { fail("Réductions illisibles", error); return; }

    const form = document.createElement("form");
    form.className = "admin-form";
    form.innerHTML = `
      <label>Produit<select name="product_id" required>${products.map((p) =>
        `<option value="${p.id}">${p.name} — ${p.format}</option>`).join("")}</select></label>
      <label>Type<select name="kind"><option value="percent">Pourcentage</option><option value="amount">Montant fixe</option></select></label>
      <label>Valeur<input name="value" type="number" step="0.01" min="0.01" required></label>
      <label>Début<input name="starts_on" type="date"></label>
      <label>Fin<input name="ends_on" type="date"></label>
      <label>Libellé (FR)<input name="label_fr" placeholder="Offre de printemps"></label>
      <p class="admin-status" data-preview></p>
      <button class="button" type="submit">Appliquer la réduction</button>`;
    host.appendChild(form);

    const preview = form.querySelector("[data-preview]");
    function updatePreview() {
      const product = products.find((p) => p.id === form.elements.product_id.value);
      const value = Number(form.elements.value.value);
      if (!product || !Number.isFinite(value) || value <= 0 || product.price_eur === null) {
        preview.textContent = ""; return;
      }
      const next = form.elements.kind.value === "percent"
        ? product.price_eur * (1 - value / 100)
        : Math.max(product.price_eur - value, 0);
      preview.textContent = `${money(product.price_eur)} → ${money(Math.round(next * 100) / 100)}`;
    }
    form.addEventListener("input", updatePreview);
    form.addEventListener("change", updatePreview);

    const { table, body } = makeTable(["Produit", "Réduction", "Période", "Actions"]);
    host.appendChild(table);

    function paint() {
      body.replaceChildren();
      reductions.forEach((reduction) => {
        const product = products.find((p) => p.id === reduction.product_id);
        const tr = document.createElement("tr");
        cell(tr, "Produit", product ? `${product.name} — ${product.format}` : reduction.product_id);
        cell(tr, "Réduction", reduction.kind === "percent" ? `-${reduction.value} %` : `-${money(reduction.value)}`);
        cell(tr, "Période", [reduction.starts_on, reduction.ends_on].filter(Boolean).join(" → ") || "permanente");
        cell(tr, "Actions", button("Retirer", async () => {
          try {
            await sb.remove("rdr_reductions", { product_id: `eq.${reduction.product_id}` });
            reductions = reductions.filter((r) => r.product_id !== reduction.product_id);
            say("Réduction retirée.");
            paint();
          } catch (error) { fail("Suppression impossible", error); }
        }));
        body.appendChild(tr);
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const payload = {
        product_id: data.get("product_id"),
        kind: data.get("kind"),
        value: Number(data.get("value")),
        starts_on: data.get("starts_on") || null,
        ends_on: data.get("ends_on") || null,
        label_fr: String(data.get("label_fr") || "").trim() || null,
      };
      try {
        // One reduction per product: upsert rather than duplicate.
        await sb.remove("rdr_reductions", { product_id: `eq.${payload.product_id}` });
        const [created] = await sb.insert("rdr_reductions", [payload]);
        reductions = [...reductions.filter((r) => r.product_id !== payload.product_id), created];
        say("Réduction appliquée.");
        paint();
      } catch (error) { fail("Réduction non appliquée", error); }
    });

    paint();
  }

  // ---------------------------------------------------------------- promos
  async function renderPromos(host) {
    let promos = [];
    try {
      promos = await sb.select("rdr_promos", { select: "*", order: "sort_key.asc" });
    } catch (error) { fail("Promotions illisibles", error); return; }
    simpleCrud({
      host,
      table: "rdr_promos",
      rows: promos,
      describe: (row) => row.title_fr,
      columns: [
        { label: "Titre", value: (r) => r.title_fr },
        { label: "Active", value: (r) => (r.is_active ? "oui" : "non") },
        { label: "Période", value: (r) => [r.starts_on, r.ends_on].filter(Boolean).join(" → ") || "permanente" },
      ],
      formHtml: (existing) => `
        <label>Titre (FR)<input name="title_fr" required value="${existing?.title_fr?.replace(/"/g, "&quot;") || ""}"></label>
        <label>Titre (DE)<input name="title_de" value="${existing?.title_de || ""}"></label>
        <label>Titre (EN)<input name="title_en" value="${existing?.title_en || ""}"></label>
        <label>Texte (FR)<textarea name="body_fr" rows="3">${existing?.body_fr || ""}</textarea></label>
        <label>Début<input name="starts_on" type="date" value="${existing?.starts_on || ""}"></label>
        <label>Fin<input name="ends_on" type="date" value="${existing?.ends_on || ""}"></label>
        <label><input name="is_active" type="checkbox"${existing?.is_active !== false ? " checked" : ""}> Active</label>`,
      toPayload: (data) => ({
        title_fr: String(data.get("title_fr")).trim(),
        title_de: String(data.get("title_de") || "").trim() || null,
        title_en: String(data.get("title_en") || "").trim() || null,
        body_fr: String(data.get("body_fr") || "").trim() || null,
        starts_on: data.get("starts_on") || null,
        ends_on: data.get("ends_on") || null,
        is_active: data.get("is_active") === "on",
      }),
    });
  }

  // ---------------------------------------------------------------- import
  function renderImport(host) {
    host.replaceChildren();
    const panel = document.createElement("section");
    panel.className = "admin-panel";
    panel.innerHTML = `
      <h2>Importer le catalogue</h2>
      <p>Reprend <code>data/catalogue.json</code> (43 producteurs, 411 produits)
        et le charge dans la base. Les produits existants sont mis à jour, aucun
        n’est supprimé. À lancer une seule fois au démarrage.</p>
      <p class="admin-status" data-import-status></p>`;
    const run = button("Lancer l’import", async () => {
      run.disabled = true;
      const report = panel.querySelector("[data-import-status]");
      try {
        report.textContent = "Lecture du catalogue…";
        const response = await fetch("../data/catalogue.json");
        if (!response.ok) throw new Error(`catalogue.json: HTTP ${response.status}`);
        const catalogue = await response.json();

        const countryRows = [...new Set(catalogue.producers.map((p) => p.country).filter(Boolean))]
          .map((name, index) => ({ id: slugify(name), name_fr: name, sort_key: index * 10 }));
        if (countryRows.length) {
          report.textContent = `Pays (${countryRows.length})…`;
          await sb.insert("rdr_countries", countryRows).catch(async () => {
            for (const row of countryRows) {
              await sb.insert("rdr_countries", [row]).catch(() => {});
            }
          });
        }

        const producerRows = catalogue.producers.map((producer, index) => ({
          id: producer.id,
          name: producer.name,
          country_id: producer.country ? slugify(producer.country) : null,
          region: producer.region || null,
          sort_key: index * 10,
        }));
        report.textContent = `Producteurs (${producerRows.length})…`;
        for (const row of producerRows) {
          await sb.insert("rdr_producers", [row]).catch(async () =>
            sb.update("rdr_producers", { id: `eq.${row.id}` }, row));
        }

        const productRows = catalogue.producers.flatMap((producer, pIndex) =>
          producer.products.map((product, index) => ({
            id: product.id,
            producer_id: producer.id,
            name: product.name,
            category: product.category || "vin",
            colour: product.colour || null,
            format: product.format,
            price_eur: product.priceOnRequest ? null : product.priceEur,
            price_on_request: Boolean(product.priceOnRequest),
            out_of_stock: Boolean(product.outOfStock),
            needs_review: Boolean(product.needsReview),
            sort_key: pIndex * 1000 + index,
          })));

        let done = 0;
        for (let i = 0; i < productRows.length; i += 50) {
          const batch = productRows.slice(i, i + 50);
          try {
            await sb.insert("rdr_products", batch);
          } catch {
            for (const row of batch) {
              await sb.insert("rdr_products", [row]).catch(async () =>
                sb.update("rdr_products", { id: `eq.${row.id}` }, row).catch(() => {}));
            }
          }
          done += batch.length;
          report.textContent = `Produits ${done} / ${productRows.length}…`;
        }

        report.textContent = `Import terminé : ${countryRows.length} pays, ${producerRows.length} producteurs, ${productRows.length} produits.`;
        await loadReferenceData();
      } catch (error) {
        fail("Import interrompu", error);
        report.textContent = `Import interrompu : ${error.message}`;
      } finally {
        run.disabled = false;
      }
    }, "button");
    panel.appendChild(run);
    host.appendChild(panel);
  }

  // ------------------------------------------------------------- workspace
  const RENDERERS = {
    orders: renderOrders,
    products: renderProducts,
    producers: renderProducers,
    countries: renderCountries,
    reductions: renderReductions,
    promos: renderPromos,
    import: renderImport,
  };

  function wireTabs() {
    document.querySelectorAll(".admin-tab").forEach((tab) => {
      tab.addEventListener("click", async () => {
        document.querySelectorAll(".admin-tab").forEach((other) => other.classList.toggle("is-active", other === tab));
        document.querySelectorAll("[data-section]").forEach((section) => {
          section.hidden = section.dataset.section !== tab.dataset.tab;
        });
        say("");
        const host = el(`[data-section="${tab.dataset.tab}"]`);
        try {
          await RENDERERS[tab.dataset.tab](host);
        } catch (error) { fail("Section indisponible", error); }
      });
    });
  }

  async function openWorkspace(email) {
    el("[data-signin-panel]").hidden = true;
    el("[data-denied-panel]").hidden = true;
    el("[data-workspace]").hidden = false;
    const user = el("[data-admin-user]");
    user.hidden = false;
    user.textContent = email;
    el("[data-sign-out]").hidden = window.RDR_CONFIG?.adminOpenMode === true;
    try {
      await loadReferenceData();
    } catch (error) {
      fail("Données de référence illisibles", error);
    }
    await renderOrders(el('[data-section="orders"]'));
  }

  /** Demo mode: no login, and the page must say so unmistakably. */
  function showOpenModeWarning() {
    const banner = document.createElement("p");
    banner.className = "admin-openmode";
    banner.textContent = "Mode démo : ce tableau de bord n’est pas protégé par mot de passe. "
      + "À reverrouiller avant la mise en service.";
    document.querySelector(".admin-main")?.prepend(banner);
  }

  async function checkAccess() {
    if (window.RDR_CONFIG?.adminOpenMode === true) {
      showOpenModeWarning();
      await openWorkspace("mode démo");
      return;
    }
    const session = sb.readSession();
    if (!session) { el("[data-signin-panel]").hidden = false; return; }
    try {
      const isAdmin = await sb.rpc("rdr_is_admin");
      if (isAdmin === true) {
        await openWorkspace(session.user?.email || "");
      } else {
        el("[data-denied-panel]").hidden = false;
      }
    } catch (error) {
      console.error("Access check failed", error);
      el("[data-signin-panel]").hidden = false;
      el("[data-signin-error]").textContent = `Vérification impossible : ${error.message}`;
    }
  }

  function boot() {
    if (!sb.isConfigured()) { el("[data-setup-panel]").hidden = false; return; }
    wireTabs();

    el("[data-signin-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const errorSlot = el("[data-signin-error]");
      errorSlot.textContent = "";
      try {
        await sb.signIn(String(data.get("email")).trim(), String(data.get("password")));
        await checkAccess();
      } catch (error) {
        errorSlot.textContent = `Connexion refusée : ${error.message}`;
      }
    });

    const signOut = () => { sb.signOut(); window.location.reload(); };
    el("[data-sign-out]").addEventListener("click", signOut);
    el("[data-sign-out-2]").addEventListener("click", signOut);

    checkAccess();
  }

  boot();
})();
