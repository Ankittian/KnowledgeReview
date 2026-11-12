import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Knowledge Review",
    short_name: "Review",
    description: "Daily flashcards that verify the SpectrumERP knowledge base.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f5f6fa",
    theme_color: "#4f46e5",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
