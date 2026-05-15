// ISO 3166-1 alpha-2 country-code allow-list and Zod helper.
//
// Used everywhere a country code crosses a trust boundary (seller onboarding,
// listing country-of-origin, restricted-item rules, ship-to). Centralising the
// list means the legal/compliance gate (cart.check_restrictions) and the seller
// catalog write surface can't drift apart — an attacker passing `"XX"` would
// otherwise slip past one but be caught by the other, depending on which
// surface they hit first.

import { z } from "zod";

// 249-entry list. Frozen at write time; if a new country emerges
// internationally, add it here rather than relaxing validation.
export const ISO_3166_1_ALPHA2: ReadonlySet<string> = new Set([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
  "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
  "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
  "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
  "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
  "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
  "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
  "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
  "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
  "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
  "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
  "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
  "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
]);

export function isIsoAlpha2(code: string): boolean {
  return ISO_3166_1_ALPHA2.has(code);
}

/** Zod schema: uppercases the input then asserts it's a known ISO alpha-2. */
export const Iso3166Alpha2Schema = z
  .string()
  .length(2)
  .transform((v) => v.toUpperCase())
  .refine((v) => ISO_3166_1_ALPHA2.has(v), {
    message: "must be an ISO 3166-1 alpha-2 country code",
  });
