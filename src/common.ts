// Central language map shared across pages/components. Extend this list to add new locales.
export const languages = [
	{ code: "id", label: "Indonesia" },
	{ code: "en", label: "English" },
] as const;

export type Language = (typeof languages)[number];
export type LanguageCode = Language["code"];

// Default language fallback when no preference is detected.
export const defaultLanguage: LanguageCode = "id";

// Button styles reused by language toggles to keep UI consistent.
export const baseLanguageButtonClass =
	"inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
export const activeLanguageButtonClass =
	"border-blue-600 bg-blue-600 text-white shadow-sm focus-visible:outline-blue-500";
export const inactiveLanguageButtonClass =
	"border-transparent bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600 focus-visible:outline-blue-500";

// Quick lookup set for verifying a language code without iterating the array.
const supportedLanguageCodes = new Set<LanguageCode>(
	languages.map((lang) => lang.code),
);

export const isSupportedLanguage = (
	code: string | null | undefined,
): code is LanguageCode =>
	!!code && supportedLanguageCodes.has(code as LanguageCode);

// Canonical frontmatter structure we expect from Markdown posts.
export type PostFrontmatter = {
	title: string;
	title_en?: string;
	description: string;
	description_en?: string;
	date: string;
	thumbnail?: string;
	layout?: string;
};

export const DEFAULT_THUMBNAIL = "/images/image.png";

// Ensure every post gets a thumbnail path; fall back to the shared asset when missing.
export const resolveThumbnail = (thumbnail?: string): string => {
	if (!thumbnail) {
		return DEFAULT_THUMBNAIL;
	}

	const trimmed = thumbnail.trim();
	return trimmed.length > 0 ? trimmed : DEFAULT_THUMBNAIL;
};

// Naive date parsing helper that shields downstream code from invalid dates.
export const parseDate = (value?: string) => {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

export const extractPostMetadata = (frontmatter: PostFrontmatter) => {
	const dateObject = parseDate(frontmatter.date);

	return {
		// Original date instance for temporal logic (optional consumers).
		date: dateObject,
		// Numeric value used for sorting by newest-first.
		sortValue: dateObject ? dateObject.valueOf() : 0,
		// Year string handy for filter dropdowns.
		year: dateObject ? String(dateObject.getFullYear()) : "Unknown",
		// Normalised thumbnail path safe for direct <img src>.
		thumbnail: resolveThumbnail(frontmatter.thumbnail),
	};
};

export type LocalizedPostText = {
	title: string;
	description: string;
};

export type LocalizedPostTexts = Record<LanguageCode, LocalizedPostText>;

// Trim text while providing a friendly fallback when values are blank.
const normalizeText = (value: string | undefined, fallback = "") =>
	value?.trim().length ? value.trim() : fallback;

// Build a stable pair of title/description strings for each language.
export const buildLocalizedPostTexts = (
	frontmatter: PostFrontmatter,
	defaultTitle = "Tanpa judul",
	defaultDescription = "",
): LocalizedPostTexts => {
	const titleId = normalizeText(frontmatter.title, defaultTitle);
	const descriptionId = normalizeText(
		frontmatter.description,
		defaultDescription,
	);
	const titleEn = normalizeText(frontmatter.title_en, titleId);
	const descriptionEn = normalizeText(
		frontmatter.description_en,
		descriptionId,
	);

	return {
		id: {
			title: titleId,
			description: descriptionId,
		},
		// Fallback gracefully to the Indonesian copy when English fields are missing.
		en: {
			title: titleEn,
			description: descriptionEn,
		},
	};
};

// Generic helper for pulling a string from a localized dictionary.
export const getLocalizedString = (
	entry: Partial<Record<LanguageCode, string>> | undefined,
	lang: LanguageCode = defaultLanguage,
	fallback?: LanguageCode,
): string => {
	if (!entry) {
		return "";
	}

	if (entry[lang]) {
		return entry[lang] as string;
	}

	const fallbackCode = fallback ?? defaultLanguage;
	if (entry[fallbackCode]) {
		return entry[fallbackCode] as string;
	}

	const firstDefined = Object.values(entry).find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return firstDefined ?? "";
};
