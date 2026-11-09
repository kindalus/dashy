/**
 * Interface language: the text of Dashy's own chrome (buttons, menus, states,
 * exports and server pages) in English and Portuguese. Browser-safe.
 * Project-authored labels (dashboards, datasets, parameters) are not translated.
 *
 * Every language has every key: `pt` is typed as `Messages`, so a missing or
 * extra key is a type error, and tests check that no text is empty.
 */
export const languages = ["en", "pt"] as const;
export type Language = (typeof languages)[number];
/** Each language in its own name, for the selector. */
export const languageNames: Record<Language, string> = { en: "English", pt: "Português" };

const en = {
  // Workspace
  skipToContent: "Skip to content",
  readOnlyWorkspace: "Read-only workspace",
  workspace: "Workspace",
  dashboards: "Dashboards",
  pages: "Pages",
  chapters: "Chapters",
  page: "Page",
  choosePage: "Choose page",
  workspaceNavigation: "Workspace navigation",
  brandHome: (application: string) => `Dashy · ${application} home`,
  requests: (count: number) => `${count} request${count === 1 ? "" : "s"}`,
  theme: "Theme",
  language: "Language",
  // Dashboard
  noDashboards: "No dashboards configured",
  loadingData: (done: number, total: number) => `Loading data (${done}/${total})…`,
  someDataFailed: "Some data could not be loaded. Retry the affected panels.",
  noBlocks: "No blocks configured",
  updatedAt: (time: string) => `Updated ${time} UTC`,
  unableToApplyFilters: "Unable to apply filters",
  unableToLoadData: "Unable to load data",
  notAppliedTo: (block: string) => `not applied to ${block}`,
  yourDashboards: "Your dashboards",
  getStarted: "Add a dashboard to your project configuration to get started.",
  print: "Print / PDF",
  refresh: "Refresh",
  applyFilters: "Apply filters",
  reset: "Reset",
  activeCrossFilters: "Active cross-filters",
  clearFilter: (label: string) => `Clear ${label} filter`,
  selectToLoad: (labels: string) => `Select ${labels} to load this dashboard.`,
  enableJavaScript: "Enable JavaScript to load dashboard data.",
  dashboardResults: "Dashboard results",
  /** Excel's FILTER function in the decorative formula bar. */
  formulaFunction: "FILTER",
  drillDownTo: (level: string) => `Drill down to ${level}`,
  filterBy: (label: string) => `Filter by ${label}`,
  open: (label: string) => `Open ${label}`,
  blockUnavailable: "Block unavailable",
  tryAgain: "Try again",
  showingPreviousData: "Showing previous data.",
  updating: "Updating…",
  loading: "Loading…",
  notFilteredBy: (labels: string) => `Not filtered by ${labels}`,
  // Metric cards
  vsPrevious: "vs previous",
  target: "Target",
  unchanged: "Unchanged",
  up: "Up",
  down: "Down",
  ofTarget: (percent: string, label: string, target: string) => `${percent} of ${label} ${target}`,
  // Datasets
  download: "Download",
  downloadBlock: (label: string) => `Download ${label}`,
  imagePng: "Image (.png)",
  imageSvg: "Image (.svg)",
  imageFailed: "The image could not be saved. Try the other format or Print / PDF.",
  rowsShownIn: (label: string) => `Rows shown in ${label}`,
  top: (count: number) => `Top ${count}`,
  bottom: (count: number) => `Bottom ${count}`,
  all: "All",
  viewOf: (label: string) => `View ${label}`,
  chart: "Chart",
  table: "Table",
  tableOf: (label: string) => `${label} table`,
  noResults: "No results for these filters. Try a different period or selection.",
  total: "Total",
  subtotal: (label: string) => `${label} total`,
  other: "Other",
  average: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
  count: "Count",
  sum: "Sum",
  rows: (count: number) => `${count} row${count === 1 ? "" : "s"}`,
  /** "Top 5 of 120 rows": `ranking` is `top(n)` or `bottom(n)`. */
  rankedRows: (ranking: string, total: number) => `${ranking} of ${total} rows`,
  rowLimitReached: "Row limit reached",
  totals: "totals",
  and: "and",
  unavailable: (what: string) => `${what} unavailable`,
  printedFirst: (count: string) => `Printed the first ${count} rows; download CSV or Excel for all`,
  previous: "Previous",
  next: "Next",
  previousPageOf: (label: string) => `Previous page of ${label}`,
  nextPageOf: (label: string) => `Next page of ${label}`,
  chartUnavailable: "Chart unavailable. Switch to Table to view the data.",
  loadingChart: "Loading chart…",
  // Drill-down
  drillHint: (from: string, to: string) => `Click a ${from} to drill down to ${to}`,
  drillDownOf: (label: string) => `${label} drill-down`,
  upOneLevel: "Up one level",
  // Chart analytics
  trendOf: (series: string) => `${series} trend`,
  forecastOf: (series: string) => `${series} forecast`,
  forecastSuffix: "(forecast)",
  forecastUnavailable: (reason: string) => `Forecast unavailable: ${reason}.`,
  periodsTooFew: "needs at least two periods",
  periodsIrregular: "periods must be evenly spaced dates (YYYY, YYYY-MM, YYYY-Qn or YYYY-MM-DD)",
  trendUnavailable: (series: string) => `${series} trend unavailable: needs at least two points.`,
  forecastNeedsValues: (series: string) => `${series} forecast unavailable: every period needs a value.`,
  forecastNeedsPeriods: (series: string, count: number) => `${series} forecast unavailable: needs at least ${count} periods.`,
  // Filters and controls
  yes: "Yes",
  no: "No",
  selectedCount: (count: number) => `${count} selected`,
  clear: "Clear",
  done: "Done",
  fewerFilters: "Fewer filters",
  moreFilters: (count: number, set: number) =>
    `+ ${count} filter${count > 1 ? "s" : ""}${set ? ` · ${set} set` : ""}`,
  filterOptions: "Filter options",
  filterNamed: (label: string) => `Filter ${label}`,
  noOptions: "No options",
  noMatches: "No matches",
  selectPlaceholder: "Select…",
  searchPlaceholder: "Search…",
  commaSeparated: "Comma-separated values",
  unableToLoadOptions: "Unable to load options",
  unableToSearch: "Unable to search",
  remove: (label: string) => `Remove ${label}`,
  presetOf: (label: string) => `${label} preset`,
  rangeFrom: (label: string) => `${label} from`,
  rangeUntil: (label: string) => `${label} until`,
  rangeTo: "to",
  custom: "Custom",
  yearToDate: "Year to date",
  monthToDate: "Month to date",
  lastClosedMonth: "Last closed month",
  last30Days: "Last 30 days",
  last12Months: "Last 12 months",
  lastClosedYear: "Last closed year",
  // Excel export: Filters sheet
  filtersSheet: "Filters",
  dataSheet: "Data",
  filter: "Filter",
  value: "Value",
  dashboard: "Dashboard",
  block: "Block",
  notAppliedToBlock: "Not applied to this block",
  drillDown: "Drill-down",
  rowsHeading: "Rows",
  rankedOf: (ranking: string, total: number, other: boolean) => `${ranking} of ${total}${other ? ", the rest as Other" : ""}`,
  allRows: (count: number) => `All ${count}`,
  sortedBy: "Sorted by",
  ascending: "ascending",
  descending: "descending",
  generated: "Generated",
  note: "Note",
  incompleteNote: "Row limit reached: the data is incomplete, so totals, subtotals and Top N were skipped.",
  // Server pages
  signInRequired: "Sign in required",
  accessDenied: "Access denied",
  notFound: "Not found",
  temporarilyUnavailable: "Temporarily unavailable",
  somethingWentWrong: "Something went wrong",
  requestFailed: "Unable to complete the request. Check the server logs.",
  pageNotFound: "Page not found",
  urlTooLong: "Request URL is too long",
  authenticationRequired: "Authentication required",
  backToWorkspace: "Back to the workspace",
  apiKeysOnly: "This workspace accepts API keys only.",
  signInAgain: "Sign in again",
  signInFailed: "Sign in failed",
  providerReturned: (error: string) => `The identity provider returned ${error}.`,
  signInExpired: "Sign in expired",
  signInInvalid: "The sign-in attempt is invalid or has expired.",
  providerRejected: "The identity provider rejected the sign-in.",
  providerUnverified: "The identity provider's response could not be verified.",
  noSubject: "The identity has no subject or e-mail.",
  noAccess: (who: string) => `${who} has no access to this workspace. Ask an administrator for a role.`,
  signOut: "Sign out",
  signedOut: "Signed out",
  signedOutMessage: "You have signed out of this workspace.",
  signInUnavailable: "Sign in unavailable",
  providerUnreachable: "The identity provider could not be reached. Try again shortly.",
};
export type Messages = typeof en;

const pt: Messages = {
  skipToContent: "Saltar para o conteúdo",
  readOnlyWorkspace: "Área de trabalho só de leitura",
  workspace: "Área de trabalho",
  dashboards: "Dashboards",
  pages: "Páginas",
  chapters: "Capítulos",
  page: "Página",
  choosePage: "Escolher página",
  workspaceNavigation: "Navegação da área de trabalho",
  brandHome: (application) => `Dashy · início de ${application}`,
  requests: (count) => `${count} ${count === 1 ? "pedido" : "pedidos"}`,
  theme: "Tema",
  language: "Idioma",
  noDashboards: "Nenhum dashboard configurado",
  loadingData: (done, total) => `A carregar dados (${done}/${total})…`,
  someDataFailed: "Não foi possível carregar alguns dados. Tente novamente nos painéis afetados.",
  noBlocks: "Nenhum bloco configurado",
  updatedAt: (time) => `Atualizado às ${time} UTC`,
  unableToApplyFilters: "Não foi possível aplicar os filtros",
  unableToLoadData: "Não foi possível carregar os dados",
  notAppliedTo: (block) => `não aplicado a ${block}`,
  yourDashboards: "Os seus dashboards",
  getStarted: "Adicione um dashboard à configuração do projeto para começar.",
  print: "Imprimir / PDF",
  refresh: "Atualizar",
  applyFilters: "Aplicar filtros",
  reset: "Repor",
  activeCrossFilters: "Filtros cruzados ativos",
  clearFilter: (label) => `Limpar filtro ${label}`,
  selectToLoad: (labels) => `Selecione ${labels} para carregar este dashboard.`,
  enableJavaScript: "Ative o JavaScript para carregar os dados do dashboard.",
  dashboardResults: "Resultados do dashboard",
  formulaFunction: "FILTRAR",
  drillDownTo: (level) => `Descer para ${level}`,
  filterBy: (label) => `Filtrar por ${label}`,
  open: (label) => `Abrir ${label}`,
  blockUnavailable: "Bloco indisponível",
  tryAgain: "Tentar novamente",
  showingPreviousData: "A mostrar os dados anteriores.",
  updating: "A atualizar…",
  loading: "A carregar…",
  notFilteredBy: (labels) => `Não filtrado por ${labels}`,
  vsPrevious: "vs período anterior",
  target: "Meta",
  unchanged: "Sem alteração",
  up: "Subida de",
  down: "Descida de",
  ofTarget: (percent, label, target) => `${percent} · ${label} ${target}`,
  download: "Transferir",
  downloadBlock: (label) => `Transferir ${label}`,
  imagePng: "Imagem (.png)",
  imageSvg: "Imagem (.svg)",
  imageFailed: "Não foi possível guardar a imagem. Experimente o outro formato ou Imprimir / PDF.",
  rowsShownIn: (label) => `Linhas mostradas em ${label}`,
  top: (count) => `Top ${count}`,
  bottom: (count) => `Últimos ${count}`,
  all: "Todos",
  viewOf: (label) => `Vista de ${label}`,
  chart: "Gráfico",
  table: "Tabela",
  tableOf: (label) => `Tabela ${label}`,
  noResults: "Sem resultados para estes filtros. Experimente outro período ou outra seleção.",
  total: "Total",
  subtotal: (label) => `Total ${label}`,
  other: "Outros",
  average: "Média",
  median: "Mediana",
  min: "Mínimo",
  max: "Máximo",
  count: "Contagem",
  sum: "Soma",
  rows: (count) => `${count} ${count === 1 ? "linha" : "linhas"}`,
  rankedRows: (ranking, total) => `${ranking} de ${total} linhas`,
  rowLimitReached: "Limite de linhas atingido",
  totals: "totais",
  and: "e",
  unavailable: (what) => `${what} indisponíveis`,
  printedFirst: (count) => `Impressas as primeiras ${count} linhas; transfira em CSV ou Excel para ver todas`,
  previous: "Anterior",
  next: "Seguinte",
  previousPageOf: (label) => `Página anterior de ${label}`,
  nextPageOf: (label) => `Página seguinte de ${label}`,
  chartUnavailable: "Gráfico indisponível. Mude para Tabela para ver os dados.",
  loadingChart: "A carregar o gráfico…",
  drillHint: (from, to) => `Clique num valor de ${from} para descer para ${to}`,
  drillDownOf: (label) => `Drill-down de ${label}`,
  upOneLevel: "Subir um nível",
  trendOf: (series) => `Tendência de ${series}`,
  forecastOf: (series) => `Previsão de ${series}`,
  forecastSuffix: "(previsão)",
  forecastUnavailable: (reason) => `Previsão indisponível: ${reason}.`,
  periodsTooFew: "são precisos pelo menos dois períodos",
  periodsIrregular: "os períodos têm de ser datas igualmente espaçadas (AAAA, AAAA-MM, AAAA-Tn ou AAAA-MM-DD)",
  trendUnavailable: (series) => `Tendência de ${series} indisponível: são precisos pelo menos dois pontos.`,
  forecastNeedsValues: (series) => `Previsão de ${series} indisponível: todos os períodos precisam de um valor.`,
  forecastNeedsPeriods: (series, count) => `Previsão de ${series} indisponível: são precisos pelo menos ${count} períodos.`,
  yes: "Sim",
  no: "Não",
  selectedCount: (count) => `${count} selecionados`,
  clear: "Limpar",
  done: "Concluído",
  fewerFilters: "Menos filtros",
  moreFilters: (count, set) =>
    `+ ${count} ${count > 1 ? "filtros" : "filtro"}${set ? ` · ${set} ${set > 1 ? "definidos" : "definido"}` : ""}`,
  filterOptions: "Filtrar opções",
  filterNamed: (label) => `Filtrar ${label}`,
  noOptions: "Sem opções",
  noMatches: "Sem correspondências",
  selectPlaceholder: "Selecionar…",
  searchPlaceholder: "Pesquisar…",
  commaSeparated: "Valores separados por vírgulas",
  unableToLoadOptions: "Não foi possível carregar as opções",
  unableToSearch: "Não foi possível pesquisar",
  remove: (label) => `Remover ${label}`,
  presetOf: (label) => `Predefinição de ${label}`,
  rangeFrom: (label) => `${label} desde`,
  rangeUntil: (label) => `${label} até`,
  rangeTo: "a",
  custom: "Personalizado",
  yearToDate: "Ano até à data",
  monthToDate: "Mês até à data",
  lastClosedMonth: "Último mês fechado",
  last30Days: "Últimos 30 dias",
  last12Months: "Últimos 12 meses",
  lastClosedYear: "Último ano fechado",
  filtersSheet: "Filtros",
  dataSheet: "Dados",
  filter: "Filtro",
  value: "Valor",
  dashboard: "Dashboard",
  block: "Bloco",
  notAppliedToBlock: "Não aplicado a este bloco",
  drillDown: "Drill-down",
  rowsHeading: "Linhas",
  rankedOf: (ranking, total, other) => `${ranking} de ${total}${other ? ", o resto como Outros" : ""}`,
  allRows: (count) => `Todas (${count})`,
  sortedBy: "Ordenado por",
  ascending: "crescente",
  descending: "decrescente",
  generated: "Gerado em",
  note: "Nota",
  incompleteNote: "Limite de linhas atingido: os dados estão incompletos, por isso os totais, subtotais e Top N foram omitidos.",
  signInRequired: "Início de sessão necessário",
  accessDenied: "Acesso negado",
  notFound: "Não encontrado",
  temporarilyUnavailable: "Temporariamente indisponível",
  somethingWentWrong: "Ocorreu um erro",
  requestFailed: "Não foi possível concluir o pedido. Consulte os registos do servidor.",
  pageNotFound: "Página não encontrada",
  urlTooLong: "O endereço do pedido é demasiado longo",
  authenticationRequired: "Autenticação necessária",
  backToWorkspace: "Voltar à área de trabalho",
  apiKeysOnly: "Esta área de trabalho só aceita chaves de API.",
  signInAgain: "Iniciar sessão novamente",
  signInFailed: "Falha no início de sessão",
  providerReturned: (error) => `O fornecedor de identidade devolveu ${error}.`,
  signInExpired: "Início de sessão expirado",
  signInInvalid: "A tentativa de início de sessão é inválida ou expirou.",
  providerRejected: "O fornecedor de identidade recusou o início de sessão.",
  providerUnverified: "Não foi possível verificar a resposta do fornecedor de identidade.",
  noSubject: "A identidade não tem identificador nem e-mail.",
  noAccess: (who) => `${who} não tem acesso a esta área de trabalho. Peça uma função a um administrador.`,
  signOut: "Terminar sessão",
  signedOut: "Sessão terminada",
  signedOutMessage: "Terminou a sessão nesta área de trabalho.",
  signInUnavailable: "Início de sessão indisponível",
  providerUnreachable: "Não foi possível contactar o fornecedor de identidade. Tente novamente dentro de momentos.",
};

export const messages: Record<Language, Messages> = { en, pt };

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (languages as readonly string[]).includes(value);
/** The interface language for a locale: pt for any Portuguese locale, otherwise English. */
export const languageOf = (locale: string): Language => (/^pt(-|$)/i.test(locale) ? "pt" : "en");
/** Interface text for a formatting locale (see `formattingLocale`, which keeps them in step). */
export const textFor = (locale: string): Messages => messages[languageOf(locale)];
/**
 * The locale numbers and dates use: the project locale when it is in the chosen
 * language (keeping, say, pt-AO), otherwise the language itself.
 */
export const formattingLocale = (projectLocale: string, language: Language): string =>
  languageOf(projectLocale) === language ? projectLocale : language;

/** Project setting: the default interface language and the languages viewers may choose. */
export interface LanguageConfig {
  /** Default interface language; otherwise derived from the project locale. */
  language?: Language;
  /** Languages offered in the selector, default all; false or [] hides it. */
  languages?: false | readonly Language[];
  locale?: string;
}
export interface ResolvedLanguage {
  name: Language;
  /** Languages the selector offers, in catalogue order; empty hides it. */
  selectable: Language[];
}

/** Validates and resolves the project's language settings. */
export function resolveLanguage(config: LanguageConfig = {}): ResolvedLanguage {
  const fail = (message: string): never => {
    throw new Error(`Invalid Dashy language: ${message}`);
  };
  if (config.language !== undefined && !isLanguage(config.language))
    fail(`language must be one of ${languages.join(", ")}`);
  const offered = config.languages;
  let selectable: Language[];
  if (offered === undefined) selectable = [...languages];
  else if (offered === false) selectable = [];
  else {
    if (!Array.isArray(offered)) return fail(`languages must be false or a list of ${languages.join(", ")}`);
    if (!offered.every(isLanguage)) fail(`languages must only contain ${languages.join(", ")}`);
    if (new Set(offered).size !== offered.length) fail("languages must not repeat a language");
    selectable = languages.filter((language) => offered.includes(language));
  }
  const name = config.language ?? languageOf(config.locale ?? "pt");
  if (config.language !== undefined && selectable.length && !selectable.includes(name))
    fail(`languages must include the default language ${name}`);
  return { name, selectable };
}

/** The viewer's language: their saved choice when the project offers it, else the project's. */
export function viewerLanguage(project: ResolvedLanguage, choice: string | undefined): Language {
  return isLanguage(choice) && project.selectable.includes(choice) ? choice : project.name;
}

export const languageCookie = "dashy_language";
export function readLanguageCookie(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === languageCookie) {
      try { return decodeURIComponent(value.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
}
/** A language from an Accept-Language header, for pages outside a project (sign-in). */
export function acceptedLanguage(header: string | null): Language | undefined {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase();
    if (/^pt(-|$)/.test(tag)) return "pt";
    if (/^en(-|$)/.test(tag)) return "en";
  }
  return undefined;
}
