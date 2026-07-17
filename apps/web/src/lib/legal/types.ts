export interface LegalDoc {
  title: string;
  updated: string; // "Last updated: …" line, pre-localized
  sections: { h: string; body: string[] }[];
}

export interface LegalSet {
  terms: LegalDoc;
  privacy: LegalDoc;
}
