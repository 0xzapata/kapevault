// ID kind: an identity card (a passport, a driver's license, a PhilSys ID). The type is a name from
// the list or any typed one ("Other"); the number and the photo of the card are secrets.

// Philippine IDs first, then the common ones. The PC page (src/features/ids/lib/ids.ts) and the phone
// import it. "Other" is not stored: any other name is.
export const ID_TYPES = ["Passport", "Driver's license", "National ID (PhilSys)", "UMID", "SSS", "PhilHealth", "Pag-IBIG", "TIN", "Postal ID", "Voter's ID", "PRC license", "Senior citizen", "PWD", "Student ID", "Company ID"];
const MAX_ID_TYPE = 60;
const MAX_ID_NUMBER = 64;

// The ID's type as a name: one from ID_TYPES or the one typed under Other.
export function cleanIdType(value) {
  const type = typeof value === "string" ? value.trim() : "";
  if (!type) throw new Error("Say which ID it is");
  if (type.length > MAX_ID_TYPE) throw new Error("That ID name is too long");
  return type;
}

// The number as printed on the card (dashes and spaces kept: "34-1234567-8"). "" = none.
export function cleanIdNumber(value) {
  const number = typeof value === "string" ? value.trim() : "";
  if (number.length > MAX_ID_NUMBER) throw new Error(`ID number can be up to ${MAX_ID_NUMBER} characters`);
  return number || undefined;
}
