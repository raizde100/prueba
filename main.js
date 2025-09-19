const API_URL = "https://contratacionesabiertas.oece.gob.pe/api/v1/records";

const form = document.getElementById("filters");
const unspscInput = document.getElementById("unspsc");
const departmentInput = document.getElementById("department");
const buyerInput = document.getElementById("buyer");
const descriptionInput = document.getElementById("description");
const pageSizeSelect = document.getElementById("pageSize");
const resultsTableBody = document.querySelector("#results tbody");
const statusText = document.getElementById("status");
const summaryText = document.getElementById("summary");
const pageInfo = document.getElementById("pageInfo");
const prevButton = document.getElementById("prevPage");
const nextButton = document.getElementById("nextPage");
const clearFiltersButton = document.getElementById("clearFilters");

let currentPage = 1;
let pageSize = Number(pageSizeSelect.value) || 50;
let ongoingFetch = null;

function getFilters() {
  return {
    unspsc: unspscInput.value.trim(),
    department: departmentInput.value.trim(),
    buyer: buyerInput.value.trim(),
    description: descriptionInput.value.trim(),
  };
}

function formatCurrency(amount, currency) {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return "No disponible";
  }

  const formatter = new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: currency || "PEN",
    maximumFractionDigits: 2,
  });

  return formatter.format(amount);
}

function formatDate(isoDate) {
  if (!isoDate) return "Sin fecha";
  try {
    return new Date(isoDate).toLocaleString("es-PE", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch (error) {
    return isoDate;
  }
}

function extractBuyerNames(compiledRelease = {}) {
  const buyers = new Set();
  const directBuyer = compiledRelease.buyer?.name;
  if (directBuyer) buyers.add(directBuyer);

  const tenderBuyer = compiledRelease.tender?.procuringEntity?.name;
  if (tenderBuyer) buyers.add(tenderBuyer);

  const parties = Array.isArray(compiledRelease.parties)
    ? compiledRelease.parties
    : [];

  parties.forEach((party) => {
    const roles = Array.isArray(party.roles) ? party.roles : [];
    if (roles.includes("buyer") || roles.includes("procuringEntity")) {
      if (party.name) buyers.add(party.name);
    }
  });

  return Array.from(buyers);
}

function extractDepartments(compiledRelease = {}) {
  const departments = new Set();
  const parties = Array.isArray(compiledRelease.parties)
    ? compiledRelease.parties
    : [];

  parties.forEach((party) => {
    const address = party.address || {};
    const department = address.department || address.region;
    if (department) {
      departments.add(department);
    }
  });

  return Array.from(departments);
}

function extractUnspscCodes(items = []) {
  const badges = new Set();

  items.forEach((item) => {
    const { classification, additionalClassifications } = item || {};
    const classifications = [];

    if (classification) classifications.push(classification);
    if (Array.isArray(additionalClassifications)) {
      classifications.push(...additionalClassifications);
    }

    classifications.forEach((code) => {
      if (!code) return;
      const scheme = (code.scheme || "").toLowerCase();
      const isUnspsc = scheme === "unspsc" || scheme === "unpsc";
      if (!isUnspsc) return;

      const id = String(code.id || "").trim();
      const description = String(code.description || "").trim();
      const label = description ? `${id} – ${description}` : id;
      if (label) badges.add(label);
    });
  });

  return Array.from(badges);
}

function extractItems(compiledRelease = {}) {
  const tenderItems = compiledRelease.tender?.items;
  if (!Array.isArray(tenderItems)) {
    return [];
  }
  return tenderItems;
}

function applyFilters(records, filters) {
  const unspscQuery = filters.unspsc.toLowerCase();
  const departmentQuery = filters.department.toLowerCase();
  const buyerQuery = filters.buyer.toLowerCase();
  const descriptionQuery = filters.description.toLowerCase();

  return records.filter((record) => {
    const compiledRelease = record?.compiledRelease || {};
    const tender = compiledRelease.tender || {};
    const items = extractItems(compiledRelease);
    const parties = Array.isArray(compiledRelease.parties)
      ? compiledRelease.parties
      : [];

    const buyerNames = extractBuyerNames(compiledRelease);

    const unspscMatches = unspscQuery
      ? items.some((item) =>
          extractUnspscCodes([item]).some((code) =>
            code.toLowerCase().includes(unspscQuery)
          )
        )
      : true;

    const departmentMatches = departmentQuery
      ? parties.some((party) => {
          const address = party.address || {};
          const combined = [
            address.department,
            address.region,
            address.locality,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return combined.includes(departmentQuery);
        })
      : true;

    const buyerMatches = buyerQuery
      ? buyerNames.some((name) => name.toLowerCase().includes(buyerQuery))
      : true;

    const descriptionMatches = descriptionQuery
      ? [
          tender.title,
          tender.description,
          ...(items.map((item) => item?.description || "") || []),
        ]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(descriptionQuery))
      : true;

    return unspscMatches && departmentMatches && buyerMatches && descriptionMatches;
  });
}

function clearTable() {
  resultsTableBody.innerHTML = "";
}

function renderNoData(message) {
  clearTable();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.textContent = message;
  row.appendChild(cell);
  resultsTableBody.appendChild(row);
}

function createList(items, className) {
  if (!items.length) return null;
  const container = document.createElement("div");
  container.className = className;
  items.forEach((item) => {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item;
    container.appendChild(badge);
  });
  return container;
}

function renderRecords(records) {
  clearTable();

  if (!records.length) {
    renderNoData("No hay resultados que coincidan con los filtros actuales.");
    return;
  }

  records.forEach((record) => {
    const compiledRelease = record?.compiledRelease || {};
    const tender = compiledRelease.tender || {};
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.className = "title-cell";

    const link = document.createElement("a");
    const detailUrl =
      record?.releases?.[0]?.url || compiledRelease?.sources?.[0]?.url || "";
    if (detailUrl) {
      link.href = detailUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.textContent = tender.title || "Sin título";
    titleCell.appendChild(link);

    const ocid = compiledRelease.ocid || record.ocid;
    if (ocid) {
      const ocidMeta = document.createElement("div");
      ocidMeta.className = "meta";
      ocidMeta.textContent = ocid;
      titleCell.appendChild(ocidMeta);
    }

    row.appendChild(titleCell);

    const buyerCell = document.createElement("td");
    const buyerNames = extractBuyerNames(compiledRelease);
    buyerCell.textContent = buyerNames.join(", ") || "Sin información";
    row.appendChild(buyerCell);

    const departmentCell = document.createElement("td");
    const departments = extractDepartments(compiledRelease);
    departmentCell.textContent = departments.join(", ") || "No registrado";
    row.appendChild(departmentCell);

    const unspscCell = document.createElement("td");
    const unspscCodes = extractUnspscCodes(extractItems(compiledRelease));
    if (unspscCodes.length) {
      const codesContainer = createList(unspscCodes, "unspsc-list");
      unspscCell.appendChild(codesContainer);
    } else {
      unspscCell.textContent = "No especificado";
    }
    row.appendChild(unspscCell);

    const amountCell = document.createElement("td");
    const tenderValue = tender.value || {};
    const amount = Number(tenderValue.amount);
    const currency = tenderValue.currency || "PEN";
    const amountText = formatCurrency(amount, currency);
    const amountSpan = document.createElement("span");
    amountSpan.className = "amount";
    amountSpan.textContent = amountText;
    amountCell.appendChild(amountSpan);
    row.appendChild(amountCell);

    const datesCell = document.createElement("td");
    const published = formatDate(tender.datePublished || compiledRelease.date);
    const updated = formatDate(compiledRelease.date);

    const publishedRow = document.createElement("div");
    const publishedLabel = document.createElement("strong");
    publishedLabel.textContent = "Publicado:";
    publishedRow.appendChild(publishedLabel);
    publishedRow.appendChild(document.createTextNode(` ${published}`));

    const updatedRow = document.createElement("div");
    const updatedLabel = document.createElement("strong");
    updatedLabel.textContent = "Actualizado:";
    updatedRow.appendChild(updatedLabel);
    updatedRow.appendChild(document.createTextNode(` ${updated}`));

    datesCell.appendChild(publishedRow);
    datesCell.appendChild(updatedRow);
    row.appendChild(datesCell);

    resultsTableBody.appendChild(row);
  });
}

function updateSummary({
  fetchedCount = 0,
  filteredCount = 0,
  totalRecords = null,
  totalPages = null,
} = {}) {
  const parts = [];
  parts.push(`Mostrando ${filteredCount} de ${fetchedCount} registros recibidos.`);

  if (Number.isFinite(totalRecords)) {
    parts.push(`Total reportado por la API: ${totalRecords}.`);
  }

  summaryText.textContent = parts.join(" ");

  const pageParts = [`Página ${currentPage}`];
  if (Number.isFinite(totalPages) && totalPages > 0) {
    pageParts.push(`de ${totalPages}`);
  }
  pageInfo.textContent = pageParts.join(" ");
}

function setStatus(message = "") {
  statusText.textContent = message;
}

function setLoading(isLoading) {
  if (isLoading) {
    setStatus("Cargando datos...");
  } else if (statusText.textContent.startsWith("Cargando")) {
    setStatus("");
  }
}

async function fetchRecords(page) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    order: "desc",
  });

  const url = `${API_URL}?${params.toString()}`;

  if (ongoingFetch) {
    ongoingFetch.abort();
  }

  const controller = new AbortController();
  ongoingFetch = controller;

  const response = await fetch(url, { signal: controller.signal });
  ongoingFetch = null;
  if (!response.ok) {
    throw new Error(`Error ${response.status} al consultar la API.`);
  }
  return response.json();
}

async function loadRecords(page = currentPage) {
  const filters = getFilters();
  setLoading(true);

  try {
    const data = await fetchRecords(page);
    const records = Array.isArray(data.records) ? data.records : [];
    const filteredRecords = applyFilters(records, filters);
    renderRecords(filteredRecords);

    const pagination = data.pagination || data.meta || {};
    const totalRecords = Number(pagination.total ?? data.total);
    const totalPages = Number(pagination.pages ?? pagination.total_pages);

    currentPage = page;

    updateSummary({
      fetchedCount: records.length,
      filteredCount: filteredRecords.length,
      totalRecords: Number.isFinite(totalRecords) ? totalRecords : null,
      totalPages: Number.isFinite(totalPages) ? totalPages : null,
    });

    const disablePrev = currentPage <= 1;
    const disableNext =
      (Number.isFinite(totalPages) && currentPage >= totalPages) ||
      (!Number.isFinite(totalPages) && records.length < pageSize);

    prevButton.disabled = disablePrev;
    nextButton.disabled = disableNext;

  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    console.error(error);
    renderNoData("No se pudieron obtener los datos de la API.");
    setStatus(
      "Ocurrió un error al consultar la API. Verifica tu conexión o intenta nuevamente."
    );
    updateSummary({ fetchedCount: 0, filteredCount: 0 });
  } finally {
    ongoingFetch = null;
    setLoading(false);
  }
}

function handleSubmit(event) {
  event.preventDefault();
  loadRecords(1);
}

function handleClear() {
  form.reset();
  pageSize = Number(pageSizeSelect.value) || 50;
  loadRecords(1);
}

function handlePageChange(increment) {
  const nextPage = Math.max(1, currentPage + increment);
  if (nextPage === currentPage) return;
  loadRecords(nextPage);
}

form.addEventListener("submit", handleSubmit);
clearFiltersButton.addEventListener("click", handleClear);
prevButton.addEventListener("click", () => handlePageChange(-1));
nextButton.addEventListener("click", () => handlePageChange(1));
pageSizeSelect.addEventListener("change", () => {
  pageSize = Number(pageSizeSelect.value) || 50;
  loadRecords(1);
});

document.addEventListener("DOMContentLoaded", () => {
  loadRecords(1);
});
