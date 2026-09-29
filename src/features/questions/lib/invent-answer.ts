// "Invent": a made-up security question answer that is easy to remember and to say on the phone,
// e.g. "velvet lantern 38". Pure; random through the password generator's unbiased randomInt.
import { randomInt } from "../../generator/lib/generate-password.ts";

// Plain words anyone can say and spell back: no sound-alikes (chilly/chili, bold/bowled, rosy/Rosie),
// no spellings that differ by country (harbour, cosy) or that people get wrong (sandal), no silent
// letters (calm, castle, island), nothing that reads as rude next to a noun (spicy).
export const ADJECTIVES = `
amber ancient brave breezy bright brisk busy cheerful clever cloudy coastal cobalt cosmic
crimson crisp curly dizzy dusty eager early easy electric emerald fancy fluffy friendly frosty fuzzy
gentle giant glad gleaming golden grand green happy hidden hollow humble humming icy jolly jumbo kind
little lively lovely loyal lucky lunar magic marble mellow mighty misty modern narrow nimble noble
orange patient peaceful playful polite precious proud purple quick quiet quirky rainy rapid rocky
royal rustic salty sandy scarlet shiny silent silky silver simple sleek sleepy smooth snowy soft
solar splendid spotted steady stormy striped sturdy swift tall tangy tender tidy tiny tropical
velvet violet vivid warm wild windy wise witty wooden yellow young zesty
`.split(/\s+/).filter(Boolean);

export const NOUNS = `
anchor apple arrow badger bagel balloon banjo basket beacon blanket bottle bramble bridge bucket
button cabin cactus camel candle canyon chimney comet copper cotton cricket cupcake dolphin dragon
drum falcon feather fern fiddle forest fossil fountain garden ginger goose granite hammock helmet
hippo jacket jasmine kettle kitten ladder lagoon lantern lemon lizard magnet mango maple meadow
mitten muffin nectar noodle ocean olive orchard otter paddle panda parrot peach pebble pelican
pepper piano pillow planet pocket pony puffin pumpkin rabbit radish raven ribbon river robin rocket
saddle shell sparrow spoon sunset teapot thimble thunder tiger tomato tower trumpet tulip
turtle valley violin walnut walrus willow window wizard zebra
`.split(/\s+/).filter(Boolean);

const pick = (words: string[]) => words[randomInt(words.length)];

// An adjective, a noun and a two-digit number (10-99). Pressing Invent again never hands back the
// answer already in the box.
export function inventAnswer(previous = ""): string {
  for (;;) {
    const answer = `${pick(ADJECTIVES)} ${pick(NOUNS)} ${10 + randomInt(90)}`;
    if (answer !== previous) return answer;
  }
}
