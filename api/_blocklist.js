// Words usernames can't contain. Not an endpoint, never sent to the browser.
// Checked after undoing common disguises: 0→o 1→i 3→e 4→a 5→s 7→t 8→b @→a $→s,
// removing _ and . between letters, and squashing repeated letters (fuuuck → fuck).

// Blocked anywhere inside a username (long or unambiguous enough not to hit normal words).
export const ANYWHERE = [
  "fuck", "fvck", "phuck", "fck", "shit", "bitch", "cunt", "nigger", "nigga", "niga", "faggot", "fagot", "retard",
  "whore", "slut", "pussy", "penis", "vagina", "porn", "hitler", "kike", "tranny",
  "asshole", "bastard", "jizz", "twat", "molest", "pedophile", "paedo", "killyourself", "wetback",
  "beaner", "blowjob", "handjob", "dildo", "boner", "horny", "milf", "hentai",
  "kkk", "siegheil", "jihad", "terrorist", "cocksucker", "motherfucker",
];

// Blocked only as a whole word (they appear inside normal words like "grape" or "raccoon").
export const WHOLE_WORD = [
  "ass", "cum", "tit", "tits", "fag", "dick", "cock", "rape", "sex", "sexy", "spic", "chink", "gook",
  "coon", "dyke", "pedo", "kys", "negro", "nig", "hoe", "thot", "wank", "nude", "nudes", "porno",
  "rapist", "anal", "nazi", "nazis", "isis",
];
