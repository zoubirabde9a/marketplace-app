import type { ReactNode } from "react";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  datePublished: string;
  dateModified: string;
  excerpt: string;
  readingMinutes: number;
  Body: () => ReactNode;
}
