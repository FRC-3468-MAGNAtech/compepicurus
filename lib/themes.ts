export type Theme = {
  id: string;
  name: string;
  tagline: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  accent: string;
  glowColor: string;
  glowColorSoft: string;
  backgroundGradient: [string, string, string];
  surfaceTint: string;
};

export const themes: Theme[] = [
  {
    id: "team",
    name: "Team Colors",
    tagline: "Red & Gold — MAGNAtech default",
    primary: "#e11d3c",
    primaryForeground: "#fff7ed",
    secondary: "#f5b400",
    accent: "#ff7a45",
    glowColor: "225, 29, 60",
    glowColorSoft: "245, 180, 0",
    backgroundGradient: ["#3a0d16", "#1a0a12", "#241102"],
    surfaceTint: "225, 29, 60",
  },
  {
    id: "biobuzz",
    name: "BIOBUZZ",
    tagline: "Beehive amber & honeycomb",
    primary: "#f5a300",
    primaryForeground: "#241902",
    secondary: "#3a2a12",
    accent: "#ffd23f",
    glowColor: "245, 163, 0",
    glowColorSoft: "255, 210, 63",
    backgroundGradient: ["#241902", "#140f08", "#2e2308"],
    surfaceTint: "245, 163, 0",
  },
];

export const defaultThemeId = themes[0].id;

export function getTheme(id: string | undefined | null): Theme {
  return themes.find((t) => t.id === id) ?? themes[0];
}
