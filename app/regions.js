// The 27 selectable regions. One source for the 3D model, search, generator and labels.
// akk = how the region reads after "für" (used in generator notes).

export const GROUPS = ["Brust", "Schultern", "Rücken", "Arme", "Rumpf", "Beine und Gesäß"];

export const REGIONS = [
  { id: "brust_oben", label: "Obere Brust", latin: "M. pectoralis major, Pars clavicularis", akk: "die obere Brust", group: "Brust", cat: "push", aliases: "pecs obere brust schrägbank" },
  { id: "brust", label: "Mittlere und untere Brust", latin: "M. pectoralis major, Pars sternocostalis", akk: "die mittlere und untere Brust", group: "Brust", cat: "push", aliases: "pecs brustmuskel" },
  { id: "serratus", label: "Sägemuskel", latin: "M. serratus anterior", akk: "den Sägemuskel", group: "Brust", cat: "push", aliases: "sägezahn rippen serratus" },
  { id: "schulter_vorne", label: "Vordere Schulter", latin: "M. deltoideus, Pars clavicularis", akk: "die vordere Schulter", group: "Schultern", cat: "push", aliases: "delta deltoid front delts" },
  { id: "schulter_seite", label: "Seitliche Schulter", latin: "M. deltoideus, Pars acromialis", akk: "die seitliche Schulter", group: "Schultern", cat: "push", aliases: "delta deltoid side delts seitheben" },
  { id: "schulter_hinten", label: "Hintere Schulter", latin: "M. deltoideus, Pars spinalis", akk: "die hintere Schulter", group: "Schultern", cat: "pull", aliases: "delta deltoid rear delts" },
  { id: "rotatoren", label: "Rotatorenmanschette", latin: "Mm. supraspinatus, infraspinatus, teres minor", akk: "die Rotatorenmanschette", group: "Schultern", cat: "pull", aliases: "rotator cuff außenrotation" },
  { id: "lat", label: "Latissimus", latin: "M. latissimus dorsi, M. teres major", akk: "den Latissimus", group: "Rücken", cat: "pull", aliases: "latissimus breiter rückenmuskel v-form klimmzug" },
  { id: "trapez_oben", label: "Oberer Trapez", latin: "M. trapezius, Pars descendens", akk: "den oberen Trapez", group: "Rücken", cat: "pull", aliases: "nacken traps shrugs" },
  { id: "trapez_mitte", label: "Mittlerer Trapez und Rhomboiden", latin: "M. trapezius, Pars transversa, Mm. rhomboidei", akk: "den mittleren Trapez und die Rhomboiden", group: "Rücken", cat: "pull", aliases: "rhomboiden traps rudern" },
  { id: "trapez_unten", label: "Unterer Trapez", latin: "M. trapezius, Pars ascendens", akk: "den unteren Trapez", group: "Rücken", cat: "pull", aliases: "traps" },
  { id: "rueckenstrecker", label: "Rückenstrecker", latin: "M. erector spinae", akk: "den Rückenstrecker", group: "Rücken", cat: "legs", aliases: "unterer rücken lower back" },
  { id: "bizeps", label: "Bizeps", latin: "M. biceps brachii", akk: "den Bizeps", group: "Arme", cat: "pull", aliases: "biceps curls" },
  { id: "brachialis", label: "Brachialis", latin: "M. brachialis", akk: "den Brachialis", group: "Arme", cat: "pull", aliases: "hammercurls oberarm" },
  { id: "trizeps_lang", label: "Trizeps, langer Kopf", latin: "M. triceps brachii, Caput longum", akk: "den langen Trizepskopf", group: "Arme", cat: "push", aliases: "triceps" },
  { id: "trizeps_kurz", label: "Trizeps, seitlicher und innerer Kopf", latin: "M. triceps brachii, Caput laterale et mediale", akk: "den seitlichen und inneren Trizepskopf", group: "Arme", cat: "push", aliases: "triceps" },
  { id: "unterarm", label: "Unterarm", latin: "Mm. antebrachii", akk: "den Unterarm", group: "Arme", cat: "pull", aliases: "forearm griffkraft" },
  { id: "bauch", label: "Gerade Bauchmuskeln", latin: "M. rectus abdominis", akk: "die geraden Bauchmuskeln", group: "Rumpf", cat: "core", aliases: "abs sixpack bauchmuskeln" },
  { id: "bauch_schraeg", label: "Schräge Bauchmuskeln", latin: "M. obliquus externus abdominis", akk: "die schrägen Bauchmuskeln", group: "Rumpf", cat: "core", aliases: "obliques seitliche bauchmuskeln" },
  { id: "gluteus_max", label: "Großer Gesäßmuskel", latin: "M. gluteus maximus", akk: "den großen Gesäßmuskel", group: "Beine und Gesäß", cat: "legs", aliases: "po hintern glutes" },
  { id: "gluteus_med", label: "Mittlerer Gesäßmuskel", latin: "M. gluteus medius, M. tensor fasciae latae", akk: "den mittleren Gesäßmuskel", group: "Beine und Gesäß", cat: "legs", aliases: "po glutes abduktoren hüfte" },
  { id: "quadrizeps", label: "Quadrizeps", latin: "M. quadriceps femoris", akk: "den Quadrizeps", group: "Beine und Gesäß", cat: "legs", aliases: "quads oberschenkel vorne" },
  { id: "beinbizeps", label: "Beinbizeps", latin: "Ischiocrurale Muskulatur", akk: "den Beinbizeps", group: "Beine und Gesäß", cat: "legs", aliases: "hamstrings oberschenkel hinten ischios" },
  { id: "adduktoren", label: "Adduktoren", latin: "Mm. adductores, M. gracilis", akk: "die Adduktoren", group: "Beine und Gesäß", cat: "legs", aliases: "innenschenkel oberschenkel innen" },
  { id: "wade", label: "Wade (Gastrocnemius)", latin: "M. gastrocnemius", akk: "die Wade", group: "Beine und Gesäß", cat: "legs", aliases: "waden calves" },
  { id: "soleus", label: "Schollenmuskel", latin: "M. soleus", akk: "den Schollenmuskel", group: "Beine und Gesäß", cat: "legs", aliases: "waden calves" },
  { id: "schienbein", label: "Schienbeinmuskel", latin: "M. tibialis anterior", akk: "den Schienbeinmuskel", group: "Beine und Gesäß", cat: "legs", aliases: "tibialis schienbein" },
];

export const byId = new Map(REGIONS.map(r => [r.id, r]));
