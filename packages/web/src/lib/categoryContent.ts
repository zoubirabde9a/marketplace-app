// Per-category SEO content. Each entry provides the unique prose that makes
// /c/[slug] a real landing page rather than a templated search result —
// Google's quality signals reward distinct copy per indexable URL.
//
// Keyed by the same slugs used in @/lib/categories. Fall back to a generic
// template when a slug isn't explicitly enriched here, so coverage of new
// Ouedkniss categories doesn't 404 (or render empty prose) the moment they
// land in the API facets.

import { humanizeCategorySlug } from "@/lib/categories";

export interface CategoryFaqItem {
  q: string;
  a: string;
}

export interface CategoryContent {
  // 2–3 paragraph intro shown above the product grid. Each paragraph is its
  // own string so the page can wrap them in <p> without parsing.
  intro: string[];
  // FAQ entries — paired with FAQPage JSON-LD on the page. Google's FAQ
  // rich-result guidelines: questions visible on page, ≤8 entries, all
  // answers in plain prose.
  faq: CategoryFaqItem[];
  // Slugs of categories to surface as "related" chips. Kept short (3–6).
  related: string[];
}

const CONTENT: Record<string, CategoryContent> = {
  telephones: {
    intro: [
      "Trouvez votre prochain téléphone parmi des milliers d'annonces de vendeurs algériens — smartphones neufs et d'occasion, iPhones, Samsung Galaxy, Xiaomi, Huawei, Tecno et Itel. Tous les prix sont affichés en dinars algériens (DZD), et chaque annonce indique clairement la wilaya du vendeur, le mode de livraison, et un indicateur de risque de contrefaçon.",
      "Le catalogue est actualisé en continu : les annonces que vous parcourez ici reflètent ce qui est réellement disponible à l'instant présent à Alger, Oran, Constantine, Annaba, Sétif, Blida et dans le reste du pays. Utilisez les filtres ci-dessous pour cibler par marque, fourchette de prix, ou vendeur, ou affinez par capacité de stockage et couleur.",
      "Si vous achetez un téléphone d'occasion, consultez notre guide d'achat dédié pour les vérifications IMEI, les signes de contrefaçon, et les prix de référence par modèle.",
    ],
    faq: [
      {
        q: "Comment vérifier qu'un téléphone d'occasion n'est pas une contrefaçon ?",
        a: "Composez *#06# sur l'appareil pour afficher son IMEI, puis vérifiez-le sur imei.info ou checkcoverage.apple.com (pour iPhone). Une copie a presque toujours un IMEI commençant par 0000, un poids plus faible que l'original, et un App Store ou Play Store qui ne fonctionne pas correctement. Chaque annonce sur Teno Store porte un indicateur de risque de contrefaçon visible.",
      },
      {
        q: "Quels sont les prix indicatifs des smartphones d'occasion en Algérie ?",
        a: "À titre de référence (mai 2026, marché algérois) : iPhone 13/13 Pro en bon état 75 000 – 110 000 DZD, Samsung Galaxy S22/S23 55 000 – 95 000 DZD, Xiaomi/Redmi Note 12-13 25 000 – 45 000 DZD, modèles d'entrée de gamme Itel/Tecno/Infinix 12 000 – 25 000 DZD. Les prix varient selon le stockage, la couleur, et l'état esthétique.",
      },
      {
        q: "Les vendeurs livrent-ils partout en Algérie ?",
        a: "La livraison dépend du vendeur. Chaque annonce indique les wilayas couvertes. La majorité des vendeurs professionnels livrent dans toute l'Algérie via les services de colis nationaux. Les vendeurs particuliers limitent souvent à leur ville (Alger, Oran, Annaba, Constantine, Sétif, Blida).",
      },
      {
        q: "Puis-je payer à la livraison ?",
        a: "Oui, le paiement à la livraison est le mode dominant en Algérie et la plupart des vendeurs l'acceptent. Le mode de paiement exact est précisé dans chaque annonce.",
      },
    ],
    related: ["smartphones", "informatique", "accessoires", "electronique_electromenager"],
  },
  informatique: {
    intro: [
      "Ordinateurs portables, PC fixes, écrans, périphériques et accessoires informatiques de vendeurs algériens. Le catalogue rassemble des marques internationales — Dell, HP, Lenovo, ASUS, Acer, Apple, MSI — et des assembleurs locaux, en neuf et en occasion. Prix en dinars algériens (DZD), wilayas et délais de livraison affichés sur chaque annonce.",
      "Que vous cherchiez un ordinateur portable pour les études, une station de travail pour le graphisme ou la programmation, ou un PC gamer, utilisez les filtres marque et prix pour cibler rapidement. Les fiches produit détaillent processeur, RAM, stockage et carte graphique quand le vendeur les renseigne.",
    ],
    faq: [
      {
        q: "Quel ordinateur portable pour les études en Algérie ?",
        a: "Pour les études générales, un budget de 60 000 – 90 000 DZD ouvre l'accès à des modèles récents avec processeur Intel Core i5 ou AMD Ryzen 5, 8 Go de RAM, et 256 Go de SSD — suffisants pour bureautique, navigation et cours en ligne. Pour les filières techniques (ingénierie, design, programmation), visez 120 000 DZD et plus pour 16 Go de RAM et une carte graphique dédiée.",
      },
      {
        q: "Vaut-il mieux acheter neuf ou d'occasion ?",
        a: "L'occasion permet d'accéder à des modèles haut de gamme à 40-60 % de leur prix d'origine. Vérifiez l'état de la batterie, l'absence de pixels morts, et demandez la facture d'origine pour la garantie résiduelle constructeur. Les annonces Teno Store affichent l'année d'achat et l'état esthétique quand le vendeur les renseigne.",
      },
      {
        q: "Y a-t-il une garantie sur les ordinateurs vendus sur Teno Store ?",
        a: "La garantie dépend du vendeur. Les vendeurs professionnels offrent généralement 3 à 12 mois de garantie magasin sur les machines neuves. Les particuliers vendent en l'état — testez l'ordinateur sur place avant le paiement.",
      },
    ],
    related: ["ordinateurs", "portables", "peripheriques", "ecrans"],
  },
  electronique_electromenager: {
    intro: [
      "Électroménager et électronique grand public en Algérie : téléviseurs, réfrigérateurs, machines à laver, climatiseurs, cuisinières, micro-ondes, et petit électroménager. Marques internationales (Samsung, LG, Brandt, Bosch, Whirlpool) et marques de fabrication locale (Condor, Iris, Cristor, Géant). Prix en dinars algériens (DZD).",
      "L'électroménager est l'une des catégories où la livraison locale fait la différence — chaque annonce précise les wilayas couvertes par le vendeur et si l'installation est incluse. Filtrez par marque, prix, ou capacité pour comparer rapidement les modèles disponibles.",
    ],
    faq: [
      {
        q: "Les vendeurs assurent-ils l'installation des gros appareils ?",
        a: "Dépend du vendeur. Les marchands professionnels d'électroménager incluent généralement l'installation et la mise en service (climatiseurs, machines à laver, cuisinières gaz) dans la wilaya de leur magasin. Vérifiez l'annonce et contactez le vendeur avant l'achat pour confirmer.",
      },
      {
        q: "Quelle est la durée de garantie standard pour l'électroménager neuf ?",
        a: "Les marques internationales offrent 1 à 2 ans de garantie constructeur en Algérie via leurs distributeurs agréés. Les marques locales (Condor, Iris, Cristor) couvrent généralement 1 à 3 ans selon le produit. La garantie magasin du vendeur s'ajoute parfois à la garantie constructeur.",
      },
      {
        q: "Peut-on acheter en plusieurs fois ?",
        a: "Le paiement en plusieurs fois (« facilité de paiement ») est proposé par certains vendeurs professionnels d'électroménager. Les conditions varient — contactez directement le vendeur dont l'annonce vous intéresse pour connaître les modalités.",
      },
    ],
    related: ["telephones", "informatique", "maison", "electromenager"],
  },
  vetements_mode: {
    intro: [
      "Mode femme, mode homme, accessoires, vêtements traditionnels et mode enfant — annonces de boutiques et de particuliers en Algérie. Marques internationales (Zara, H&M, Nike, Adidas, Lacoste) et créateurs algériens. Les prix sont en dinars algériens (DZD) et chaque annonce affiche la wilaya du vendeur.",
      "Pour la mode traditionnelle — caftans, robes karakou, abayas, jellabas — les annonces précisent la taille, la couleur, et souvent l'artisan ou la wilaya de fabrication. Filtrez par catégorie et prix pour parcourir rapidement les annonces actives.",
    ],
    faq: [
      {
        q: "Comment vérifier la taille avant d'acheter en ligne ?",
        a: "Demandez au vendeur les mesures exactes (longueur, largeur épaules, tour de poitrine, tour de taille) avant le paiement. Pour les vêtements traditionnels confectionnés sur mesure, l'artisan vous demandera généralement vos propres mesures avant de finaliser la commande.",
      },
      {
        q: "Les vendeurs acceptent-ils les retours ?",
        a: "La politique de retour dépend de chaque vendeur. Les boutiques professionnelles acceptent souvent un échange sous 48-72 h si le produit n'a pas été porté ; les particuliers vendent généralement en l'état. Confirmez avec le vendeur avant l'achat.",
      },
    ],
    related: ["mode", "femme", "homme", "traditionnel", "accessoires"],
  },
  automobiles_vehicules: {
    intro: [
      "Annonces automobiles en Algérie — voitures neuves et d'occasion, motos, utilitaires, pièces détachées et accessoires automobiles. Marques européennes (Renault, Peugeot, Citroën, Volkswagen, Dacia), asiatiques (Toyota, Hyundai, Kia, Suzuki) et locales. Prix en dinars algériens (DZD), wilaya d'immatriculation affichée.",
      "Pour une voiture d'occasion, vérifiez systématiquement la carte grise, le kilométrage, le contrôle technique en cours, et l'historique d'entretien. Les annonces Teno Store affichent l'année du véhicule, le kilométrage et la motorisation quand le vendeur les renseigne.",
    ],
    faq: [
      {
        q: "Quelles vérifications faire avant d'acheter une voiture d'occasion ?",
        a: "Demandez la carte grise au nom du vendeur, vérifiez la concordance des numéros (châssis, moteur), exigez un contrôle technique en cours de validité, et faites contrôler la voiture par un mécanicien indépendant avant le paiement. Vérifiez aussi auprès du service compétent qu'il n'y a pas de gage ou d'opposition sur le véhicule.",
      },
      {
        q: "Comment se passe le changement de propriétaire ?",
        a: "Le vendeur doit fournir la carte grise barrée et signée, un certificat de cession, et un quitus fiscal (certificat de non-gage). Le nouveau propriétaire dispose de 30 jours pour faire la déclaration au service des immatriculations de sa wilaya.",
      },
    ],
    related: ["voitures", "motos", "vehicules"],
  },
  sante_beaute: {
    intro: [
      "Produits de santé, beauté et bien-être de vendeurs algériens : cosmétiques, soins de la peau, parfums, maquillage, produits capillaires, équipements de fitness, et compléments alimentaires. Marques internationales et marques locales algériennes. Prix en dinars algériens (DZD).",
      "Pour les produits cosmétiques et parfums, vérifiez systématiquement la provenance et la date de péremption avant l'achat. Les contrefaçons sont fréquentes dans cette catégorie — Teno Store affiche un indicateur de risque sur chaque annonce.",
    ],
    faq: [
      {
        q: "Comment éviter les contrefaçons de parfums et cosmétiques ?",
        a: "Achetez de préférence chez des vendeurs professionnels (boutiques, parapharmacies) plutôt que chez des particuliers anonymes. Vérifiez le packaging (qualité d'impression, codes-barres), la concordance du numéro de lot, et méfiez-vous des prix anormalement bas (-50 % par rapport au prix officiel constructeur).",
      },
      {
        q: "Les produits ont-ils une date de péremption visible ?",
        a: "Demandez systématiquement la date de péremption ou le numéro de lot avant le paiement — un produit cosmétique périmé peut causer des réactions cutanées. Les vendeurs sérieux indiquent la date dans la description ou la transmettent sur demande.",
      },
    ],
    related: ["mode", "femme", "accessoires"],
  },

  // -- Téléphonie : sous-catégorie --
  smartphones: {
    intro: [
      "Smartphones neufs et d'occasion proposés par des vendeurs algériens : iPhone, Samsung Galaxy, Xiaomi, Redmi, Huawei, Honor, Oppo, Realme, Tecno, Infinix, Itel. Le catalogue couvre toutes les gammes, du téléphone d'entrée de gamme autour de 15 000 DZD au flagship récent au-delà de 200 000 DZD. Chaque annonce affiche la wilaya du vendeur, le mode de livraison et un indicateur de risque de contrefaçon.",
      "À titre indicatif (marché algérois, mai 2026) : un iPhone 12 en bon état se négocie autour de 60 000 – 80 000 DZD, un iPhone 13 entre 75 000 et 110 000 DZD, un Samsung Galaxy S22 entre 55 000 et 80 000 DZD, et un Redmi Note 13 neuf autour de 35 000 – 45 000 DZD. Les prix varient selon le stockage (128 Go vs 256 Go), la couleur, l'état de la batterie et la présence ou non de la facture d'origine.",
      "Avant l'achat d'un appareil d'occasion, demandez l'IMEI au vendeur (code *#06#) et vérifiez-le sur imei.info ou checkcoverage.apple.com pour un iPhone. Pensez aussi à contrôler l'état de la batterie (pour iPhone : Réglages › Batterie › État de la batterie), la présence de pixels morts sur l'écran, et le bon fonctionnement de la charge, du Wi-Fi et de la 4G.",
    ],
    faq: [
      {
        q: "Comment savoir si un smartphone est neuf, reconditionné ou d'occasion ?",
        a: "Demandez la facture d'achat d'origine et vérifiez la date d'activation : sur iPhone, allez dans Réglages › Général › Informations et croisez le numéro de série avec checkcoverage.apple.com. Un appareil « neuf scellé » doit avoir son emballage sous blister d'origine intact et n'avoir jamais été activé.",
      },
      {
        q: "Les smartphones vendus sont-ils débloqués tous opérateurs ?",
        a: "La grande majorité des smartphones vendus en Algérie sont débloqués et compatibles avec Mobilis, Djezzy et Ooredoo. Pour un appareil importé de l'étranger, demandez confirmation au vendeur et testez avec votre carte SIM avant le paiement.",
      },
      {
        q: "La garantie constructeur est-elle valable en Algérie ?",
        a: "Les marques disposant d'un distributeur officiel en Algérie (Samsung, Condor, Huawei, Xiaomi via certains revendeurs) honorent la garantie locale sur facture. Les appareils importés en parallèle (« import ») n'ont généralement qu'une garantie magasin du vendeur, dont la durée varie de 3 à 12 mois.",
      },
      {
        q: "Quel stockage choisir pour un usage courant ?",
        a: "128 Go suffisent pour un usage standard (réseaux sociaux, photos occasionnelles, quelques applications). Si vous filmez en 4K, jouez à des jeux lourds, ou stockez beaucoup de musique hors ligne, visez 256 Go. L'écart de prix entre 128 et 256 Go est généralement de 8 000 à 15 000 DZD.",
      },
    ],
    related: ["telephones", "accessoires", "informatique", "electronique_electromenager"],
  },

  // -- Informatique : sous-catégories --
  ordinateurs: {
    intro: [
      "Ordinateurs fixes, tours assemblées, PC gamer et stations de travail proposés par des vendeurs et assembleurs algériens. Vous trouverez aussi bien des configurations sur mesure (assembleurs d'Alger, Oran, Constantine, Blida) que des PC de marque Dell, HP, Lenovo, ASUS ou des mini-PC. Prix en dinars algériens (DZD), wilaya et délais affichés sur chaque annonce.",
      "Pour un PC bureautique correct (Intel Core i3/i5 de 12e ou 13e génération, 8 Go de RAM, SSD 256 Go), comptez 70 000 – 110 000 DZD. Une configuration gamer milieu de gamme (Ryzen 5, 16 Go, GTX 1660 / RTX 3050, SSD 512 Go) se situe entre 150 000 et 230 000 DZD. Au-delà de 300 000 DZD, on entre dans les configurations RTX 4070 et plus, recommandées pour le streaming, la 3D et le montage vidéo.",
    ],
    faq: [
      {
        q: "Vaut-il mieux acheter un PC monté ou faire assembler une configuration ?",
        a: "Un assembleur local choisit les composants selon votre usage et votre budget, et garantit la compatibilité. C'est souvent moins cher qu'un PC de marque à performance équivalente. Demandez la liste détaillée des références (carte mère, processeur, alimentation, mémoire) et conservez les factures de chaque composant pour la garantie.",
      },
      {
        q: "Quelle alimentation choisir pour un PC gamer ?",
        a: "Pour une configuration milieu de gamme jusqu'à une RTX 3060/4060, une alimentation 550 – 650 W certifiée 80+ Bronze suffit. Pour une RTX 4070 ou plus, visez 750 W minimum, idéalement 80+ Gold. Évitez les marques inconnues : une alimentation défectueuse peut endommager tous les autres composants.",
      },
      {
        q: "Les vendeurs livrent-ils et installent-ils le PC ?",
        a: "La livraison dépend du vendeur — la majorité des assembleurs livrent dans leur wilaya et expédient via colis nationaux pour le reste du pays. L'installation logicielle (Windows, drivers, suite bureautique) est généralement incluse chez les assembleurs professionnels ; vérifiez avec le vendeur avant l'achat.",
      },
    ],
    related: ["informatique", "portables", "peripheriques", "ecrans"],
  },
  portables: {
    intro: [
      "Ordinateurs portables neufs et d'occasion sur Teno Store : ultrabooks pour le travail mobile, portables bureautiques, machines pour étudiants, PC portables gamer et MacBook. Marques disponibles : Dell, HP, Lenovo, ASUS, Acer, MSI, Apple, Huawei. Prix en dinars algériens (DZD).",
      "Fourchettes indicatives (mai 2026) : entrée de gamme bureautique 50 000 – 80 000 DZD, milieu de gamme 14 pouces avec SSD et Core i5/Ryzen 5 entre 90 000 et 140 000 DZD, ultrabooks fins type XPS / MacBook Air entre 180 000 et 280 000 DZD, portables gamer RTX 4060 à partir de 250 000 DZD. Les annonces affichent le processeur, la RAM, le stockage et la carte graphique quand le vendeur les renseigne.",
      "Pour un usage étudiant (cours en ligne, bureautique, recherche), 8 Go de RAM et un SSD de 256 Go sont le minimum recommandé. Pour la programmation, le design ou la 3D, visez 16 Go de RAM et un SSD de 512 Go au minimum. Vérifiez l'état de la batterie avant l'achat d'un portable d'occasion — c'est le composant qui vieillit le plus vite.",
    ],
    faq: [
      {
        q: "Comment vérifier l'état de la batterie d'un portable d'occasion ?",
        a: "Sur Windows, ouvrez l'invite de commande en administrateur et tapez « powercfg /batteryreport » : le rapport HTML généré indique la capacité actuelle par rapport à la capacité d'origine. En dessous de 70 %, la batterie devra être remplacée prochainement. Sur MacBook, allez dans Réglages › Batterie › État pour voir la capacité maximale.",
      },
      {
        q: "Les MacBook vendus en Algérie sont-ils sous garantie Apple ?",
        a: "La garantie Apple est mondiale pour les défauts matériels couverts. Vérifiez le numéro de série sur checkcoverage.apple.com pour connaître la date de fin de garantie. Le service après-vente Apple n'a pas de centre officiel en Algérie ; pour une réparation sous garantie, il faut généralement passer par un revendeur agréé ou expédier l'appareil hors du pays.",
      },
      {
        q: "AZERTY ou QWERTY : quel clavier choisir ?",
        a: "Les portables vendus officiellement en Algérie sont généralement en AZERTY français. Les machines importées des États-Unis ou d'Asie peuvent être en QWERTY — vérifiez les photos du clavier dans l'annonce avant l'achat. Le passage d'un layout à l'autre se fait dans les paramètres Windows mais la sérigraphie des touches reste, elle, physique.",
      },
    ],
    related: ["ordinateurs", "informatique", "peripheriques", "ecrans"],
  },
  peripheriques: {
    intro: [
      "Périphériques informatiques chez des vendeurs algériens : claviers, souris, casques audio, webcams, hubs USB, imprimantes, scanners, disques durs externes, clés USB et cartes mémoire. Marques internationales (Logitech, Razer, HyperX, Corsair, Canon, HP, SanDisk, Seagate, WD) et marques d'entrée de gamme. Prix en dinars algériens (DZD).",
      "Pour un poste de travail confortable, un combo clavier-souris filaire de marque commence autour de 4 000 DZD ; un clavier mécanique gamer se situe entre 12 000 et 35 000 DZD selon les switches et le rétroéclairage. Un casque audio correct pour visioconférences et gaming léger : 5 000 – 15 000 DZD. Les imprimantes multifonctions jet d'encre démarrent autour de 18 000 DZD, les modèles laser monochromes autour de 25 000 DZD.",
    ],
    faq: [
      {
        q: "Cartouches d'imprimante : compatibles ou originales ?",
        a: "Les cartouches originales garantissent la qualité d'impression et la durée de vie de l'imprimante, mais coûtent 2 à 3 fois plus cher que les compatibles. Pour un usage occasionnel, les compatibles de marques reconnues sont acceptables. Pour des impressions photo ou un usage intensif, restez sur les cartouches d'origine.",
      },
      {
        q: "Quel disque dur externe choisir pour sauvegarder mes données ?",
        a: "Pour de la sauvegarde simple, un disque mécanique 2,5 pouces de 1 ou 2 To (autour de 8 000 – 14 000 DZD) suffit. Pour transporter régulièrement des fichiers volumineux ou éditer directement depuis le disque, privilégiez un SSD externe USB-C (à partir de 12 000 DZD pour 500 Go) — beaucoup plus rapide et résistant aux chocs.",
      },
      {
        q: "Les périphériques sont-ils compatibles avec Mac ?",
        a: "La plupart des claviers et souris USB ou Bluetooth fonctionnent immédiatement sur macOS. Pour les imprimantes, vérifiez sur le site du constructeur qu'un pilote Mac récent est disponible. Certains logiciels de personnalisation (Razer Synapse, Logitech G Hub) ne sont disponibles que sur Windows.",
      },
    ],
    related: ["informatique", "ordinateurs", "portables", "ecrans", "accessoires"],
  },
  ecrans: {
    intro: [
      "Écrans d'ordinateur sur Teno Store : moniteurs bureautiques 24 pouces, écrans gaming 144 Hz, écrans incurvés ultrawide, écrans 4K pour le design et le montage vidéo. Marques principales : Samsung, LG, Dell, AOC, BenQ, ASUS, MSI, HP. Prix en dinars algériens (DZD), wilaya et délai de livraison sur chaque annonce.",
      "Repères de prix (mai 2026) : un 24 pouces Full HD 75 Hz pour la bureautique se situe autour de 22 000 – 32 000 DZD. Un 27 pouces Full HD 144 Hz gaming entre 45 000 et 70 000 DZD. Un 27 pouces 2K 165 Hz IPS entre 70 000 et 110 000 DZD. Les écrans 4K et les ultrawide 34 pouces démarrent autour de 90 000 – 130 000 DZD selon la dalle.",
    ],
    faq: [
      {
        q: "Quelle taille d'écran choisir pour un bureau standard ?",
        a: "À une distance de lecture de 60 – 80 cm, un 24 pouces Full HD reste confortable. Le 27 pouces gagne en popularité car il offre plus d'espace de travail sans fatigue oculaire. Au-delà de 32 pouces, mieux vaut passer à une définition 2K ou 4K pour éviter une image granuleuse.",
      },
      {
        q: "144 Hz, c'est utile en dehors du jeu vidéo ?",
        a: "Oui : le simple fait de déplacer la souris ou de faire défiler une page web est visiblement plus fluide en 144 Hz qu'en 60 Hz. Pour la bureautique pure, ce n'est pas indispensable. Pour le gaming compétitif (FPS, e-sport), 144 Hz est devenu un standard et 240 Hz le haut de gamme.",
      },
      {
        q: "Comment vérifier l'absence de pixels morts ?",
        a: "Demandez au vendeur de brancher l'écran avant l'achat et affichez successivement un fond entièrement noir, blanc, rouge, vert, puis bleu. Les pixels morts apparaissent comme des points noirs sur fond clair ou colorés sur fond noir. Les sites « Eizo Monitor Test » et « UFO Test » sont les outils de référence pour ce contrôle.",
      },
    ],
    related: ["informatique", "ordinateurs", "portables", "peripheriques"],
  },

  // -- Électroménager : sous-catégorie --
  electromenager: {
    intro: [
      "Électroménager neuf et d'occasion en Algérie : réfrigérateurs, congélateurs, machines à laver, lave-vaisselle, cuisinières gaz et mixtes, fours encastrables, hottes, climatiseurs split, chauffe-eau, micro-ondes et petit électroménager (mixeurs, robots, friteuses, machines à café). Marques internationales (Samsung, LG, Bosch, Brandt, Beko, Whirlpool) et marques de production locale (Condor, Iris, Cristor, Géant, Brandt Algérie).",
      "Repères de prix (mai 2026) : réfrigérateur combiné 350 L autour de 70 000 – 130 000 DZD, machine à laver 7 kg entre 55 000 et 110 000 DZD, cuisinière 5 feux entre 45 000 et 90 000 DZD, climatiseur split 12 000 BTU autour de 70 000 – 120 000 DZD pose comprise. Les marques locales sont généralement 20 à 40 % moins chères que les modèles internationaux à capacité équivalente.",
      "Pour les gros appareils, les vendeurs professionnels d'Alger, Oran, Constantine, Annaba, Sétif et Blida proposent souvent livraison et installation à domicile dans leur wilaya. Vérifiez si l'évacuation de l'ancien appareil est incluse — c'est un service couramment proposé, mais qui doit être confirmé avant la commande.",
    ],
    faq: [
      {
        q: "Y a-t-il une différence de fiabilité entre marques locales et marques importées ?",
        a: "Les marques algériennes (Condor, Iris) ont nettement progressé en qualité et offrent un bon rapport qualité-prix, surtout sur les réfrigérateurs et les téléviseurs. Pour des machines à laver très sollicitées ou un usage professionnel, les marques internationales (Bosch, LG, Samsung) gardent un avantage en longévité et en disponibilité des pièces détachées sur 8 – 10 ans.",
      },
      {
        q: "Comment se déroule l'installation d'un climatiseur split ?",
        a: "Un installateur certifié vient percer le mur, fixer l'unité intérieure et extérieure, faire les raccordements frigorifiques et électriques, et procéder au tirage au vide avant la mise en service. Comptez 2 à 4 heures d'intervention. Le tarif d'installation est généralement compris entre 8 000 et 15 000 DZD, souvent inclus dans le prix de vente chez les marchands professionnels.",
      },
      {
        q: "Quelle est la consommation électrique à surveiller ?",
        a: "Sur les nouveaux appareils, l'étiquette énergie (classe A à G dans le nouveau barème européen) est un indicateur fiable. Un réfrigérateur classe A consomme environ 150 kWh/an, contre 350 kWh/an pour un classe F équivalent. Pour les climatiseurs, regardez le SEER (efficacité saisonnière) plutôt que la puissance brute en BTU.",
      },
      {
        q: "Que faire si l'appareil tombe en panne pendant la garantie ?",
        a: "Conservez la facture du vendeur et le bon de garantie. Contactez d'abord le vendeur, qui orientera soit vers son SAV magasin, soit vers le service après-vente officiel de la marque en Algérie. Les marques disposant d'un réseau SAV national (Condor, Samsung, LG, Brandt) interviennent généralement à domicile pour le gros électroménager.",
      },
    ],
    related: ["electronique_electromenager", "maison", "salon", "decoration"],
  },

  // -- Mode : sous-catégories --
  mode: {
    intro: [
      "Mode pour toute la famille sur Teno Store : vêtements femme, homme et enfant, chaussures, sacs, accessoires, sous-vêtements, prêt-à-porter et tenues traditionnelles algériennes. Marques internationales (Zara, H&M, Mango, Nike, Adidas, Lacoste, Tommy Hilfiger) et créateurs locaux algériens. Prix en dinars algériens (DZD).",
      "Le catalogue regroupe à la fois des boutiques professionnelles d'Alger, Oran et Constantine, des marchands de souks bien identifiés (Bab Ezzouar, Belcourt, Médéa), et des particuliers qui revendent leurs pièces peu portées. Filtrez par genre, taille, marque ou fourchette de prix pour parcourir rapidement ce qui correspond à vos critères.",
    ],
    faq: [
      {
        q: "Comment être sûr·e de la taille avant de commander ?",
        a: "Les tailles peuvent varier d'une marque à l'autre. Demandez au vendeur les mesures à plat du vêtement (longueur, largeur poitrine, largeur épaules) et comparez-les avec un vêtement similaire que vous possédez déjà. Pour les chaussures, demandez la longueur intérieure en centimètres plutôt que de vous fier uniquement à la pointure.",
      },
      {
        q: "Comment reconnaître une contrefaçon de marque ?",
        a: "Vérifiez la qualité des coutures, la régularité de l'impression du logo, le poids des matériaux, et la présence d'étiquettes intérieures complètes (composition, lieu de fabrication, numéro de référence). Les prix anormalement bas (-70 % par rapport au prix officiel) sont presque toujours synonymes de contrefaçon — privilégiez les vendeurs établis pour les marques premium.",
      },
      {
        q: "Les vendeurs acceptent-ils l'échange si la taille ne convient pas ?",
        a: "Les boutiques professionnelles acceptent généralement l'échange sous 48 à 72 heures, à condition que l'article n'ait pas été porté et que les étiquettes soient encore en place. Les particuliers vendent le plus souvent en l'état, sans possibilité de retour. Confirmez la politique d'échange avant le paiement.",
      },
    ],
    related: ["vetements_mode", "femme", "homme", "accessoires", "traditionnel"],
  },
  femme: {
    intro: [
      "Mode femme sur Teno Store : robes, jupes, pantalons, jeans, tops, blouses, vestes, manteaux, lingerie, chaussures, sacs à main et accessoires. Vous trouverez aussi bien des marques internationales (Zara, Mango, H&M, Bershka, Stradivarius) que des créatrices algériennes et des pièces vintage ou peu portées vendues par des particulières.",
      "Pour les pièces de cérémonie (mariage, fiançailles, henna), la rubrique inclut des robes de soirée, des tenues orientales et des caftans modernes — les modèles sur mesure sont confectionnés par des couturières d'Alger, Oran, Constantine, Tlemcen et Sétif. Les prix s'échelonnent de 3 000 DZD pour un top simple à plus de 80 000 DZD pour une robe de soirée brodée.",
    ],
    faq: [
      {
        q: "Comment commander une tenue sur mesure ?",
        a: "Contactez la couturière ou la créatrice directement via l'annonce. Elle vous demandera vos mesures (tour de poitrine, tour de taille, tour de hanches, longueur souhaitée) ainsi que la couleur et la matière souhaitées. Comptez généralement 2 à 6 semaines de confection pour une robe de soirée, selon la complexité de la broderie.",
      },
      {
        q: "Quelle différence entre une abaya et un caftan ?",
        a: "L'abaya est une robe ample, souvent noire ou de couleur unie, portée par-dessus les vêtements ; elle privilégie la sobriété et le confort quotidien. Le caftan est une robe longue de cérémonie, souvent richement brodée et colorée, portée pour les mariages, les fêtes religieuses ou les soirées familiales. Les deux coexistent dans la mode féminine algérienne contemporaine.",
      },
      {
        q: "Comment entretenir une robe brodée à la main ?",
        a: "Lavez-la à la main à l'eau froide avec un savon doux, ou confiez-la à un pressing qui maîtrise les pièces traditionnelles. N'essorez jamais en tordant les broderies. Séchez à plat à l'ombre. Pour le repassage, retournez la robe et utilisez un linge humide entre le fer et le tissu pour protéger les fils dorés ou argentés.",
      },
    ],
    related: ["mode", "vetements_mode", "homme", "traditionnel", "accessoires"],
  },
  homme: {
    intro: [
      "Mode homme sur Teno Store : costumes, vestes, chemises, polos, t-shirts, jeans, pantalons, chaussures de ville et baskets, sous-vêtements, ceintures, montres et accessoires. Marques internationales (Lacoste, Tommy Hilfiger, Levi's, Nike, Adidas, Puma, Hugo Boss) et marques locales algériennes, à des prix en dinars algériens (DZD).",
      "Pour un costume de cérémonie (mariage, entretien d'embauche), comptez à partir de 25 000 DZD pour un costume d'entrée de gamme prêt-à-porter, et jusqu'à 80 000 – 120 000 DZD pour un costume sur mesure chez un tailleur d'Alger, Oran ou Constantine. Les baskets de marque (Nike, Adidas) authentiques se situent entre 12 000 et 35 000 DZD selon le modèle ; méfiez-vous des prix inférieurs à 7 000 DZD pour les éditions limitées.",
    ],
    faq: [
      {
        q: "Comment vérifier l'authenticité d'une paire de baskets de marque ?",
        a: "Demandez des photos détaillées de l'étiquette intérieure (numéro SKU, code-barre, taille), de la boîte (alignement du logo, qualité d'impression), et du dessous de la semelle. Croisez le SKU avec le site officiel de la marque pour vérifier que le modèle, la couleur et la taille existent réellement dans cette référence.",
      },
      {
        q: "Sur mesure ou prêt-à-porter pour un costume ?",
        a: "Le prêt-à-porter est plus rapide et moins cher, mais nécessite presque toujours des retouches (longueur de pantalon, manches, taille de veste) — prévoyez 1 500 à 4 000 DZD pour ces ajustements. Le sur mesure offre une coupe parfaite et le choix du tissu, mais demande 3 à 6 semaines de confection et un budget supérieur de 30 à 50 %.",
      },
      {
        q: "Quels accessoires complètent une tenue formelle ?",
        a: "Une ceinture en cuir assortie aux chaussures (noir avec noir, marron avec marron), une cravate ou un nœud papillon en soie pour les cérémonies, et une montre classique discrète. Pour un mariage ou un entretien d'embauche, privilégiez les couleurs sobres : bleu marine, gris anthracite ou noir pour le costume, blanc ou bleu pâle pour la chemise.",
      },
    ],
    related: ["mode", "vetements_mode", "femme", "accessoires", "traditionnel"],
  },
  accessoires: {
    intro: [
      "Accessoires en tout genre sur Teno Store : sacs à main, portefeuilles, ceintures, lunettes de soleil, montres, bijoux fantaisie et bijoux en or et argent, foulards, chapeaux, ainsi que les accessoires pour téléphones (coques, chargeurs, écouteurs, supports). Vendeurs établis à Alger, Oran, Constantine, Annaba, Sétif, Blida et dans toutes les wilayas du pays.",
      "Pour les bijoux en or, les vendeurs sérieux indiquent toujours le titre (18 carats, 21 carats, 24 carats) et le poids exact en grammes — le prix se calcule au cours du gramme du jour. Pour les montres, les marques de luxe (Rolex, Omega, Tag Heuer) sont très contrefaites : exigez la boîte d'origine, les papiers, et idéalement la facture d'achat avant tout paiement important.",
    ],
    faq: [
      {
        q: "Comment vérifier le poinçon d'un bijou en or ?",
        a: "Les bijoux en or vendus officiellement en Algérie portent un poinçon de l'État indiquant le titre (750 pour 18 carats, 875 pour 21 carats). Demandez à voir le poinçon à la loupe avant l'achat. Pour les pièces importantes, faites peser et tester le bijou par un bijoutier indépendant — le test à l'acide ou au testeur électronique prend quelques minutes.",
      },
      {
        q: "Les coques et chargeurs sont-ils universels ?",
        a: "Les coques sont spécifiques à chaque modèle de téléphone — précisez la référence exacte au vendeur (par exemple « iPhone 13 Pro Max » et non « iPhone 13 »). Les chargeurs USB-C et Lightning sont compatibles avec la plupart des appareils récents ; vérifiez la puissance (en watts) pour la charge rapide.",
      },
      {
        q: "Vrai cuir ou synthétique : comment faire la différence ?",
        a: "Le cuir véritable a une odeur caractéristique, des veines irrégulières, et se réchauffe au contact de la main. Le synthétique est froid, lisse de façon trop régulière et n'a pas d'odeur naturelle. À l'intérieur d'un sac, le cuir véritable présente souvent un envers non traité où l'on voit le grain naturel ; le synthétique est uniforme des deux côtés.",
      },
    ],
    related: ["mode", "vetements_mode", "femme", "homme", "telephones"],
  },
  traditionnel: {
    intro: [
      "Mode traditionnelle algérienne et maghrébine sur Teno Store : caftans, robes karakou, robes kabyles brodées, gandouras, jellabas, abayas, djellabas, fouta, burnous, ainsi que les accessoires associés (ceintures M'doura, foulards traditionnels, bijoux berbères). Vendeurs et artisanes des régions emblématiques : Tlemcen, Constantine, Annaba, Kabylie, Alger, Béjaïa.",
      "Les prix varient considérablement selon le travail de broderie : une gandoura simple en coton démarre autour de 4 000 DZD, un karakou brodé main pour mariage peut dépasser 100 000 DZD, et un caftan de cérémonie haut de gamme avec broderies fil d'or atteint 150 000 à 300 000 DZD. Beaucoup de pièces sont confectionnées sur mesure — la cliente fournit ses mesures et un délai de 3 à 8 semaines est à prévoir.",
    ],
    faq: [
      {
        q: "Quelles sont les pièces traditionnelles à porter lors d'un mariage algérien ?",
        a: "Le mariage algérien implique généralement plusieurs tenues : un caftan ou une robe karakou pour la cérémonie principale, une robe constantinoise (« blouza ») pour la mariée constantinoise, une robe kabyle pour la soirée du henna, et parfois une fergani ou une chedda tlemcénienne selon les régions. Les invitées portent également des tenues traditionnelles colorées.",
      },
      {
        q: "Quelle différence entre karakou et caftan ?",
        a: "Le karakou est une veste courte brodée d'inspiration ottomane, portée avec un saroual ou une jupe, typique d'Alger et du nord algérien. Le caftan est une robe longue d'une seule pièce, plutôt d'origine marocaine mais largement adoptée en Algérie pour les cérémonies. Les deux sont brodés et richement ornés.",
      },
      {
        q: "Comment commander une tenue sur mesure auprès d'une artisane ?",
        a: "Contactez l'artisane via l'annonce, fournissez vos mesures précises (poitrine, taille, hanches, longueur souhaitée, tour de bras) et choisissez le tissu, la couleur et le motif de broderie. Un acompte est généralement demandé. Conservez les échanges écrits pour référence et prévoyez un essayage intermédiaire si vous habitez la même wilaya.",
      },
    ],
    related: ["femme", "mode", "vetements_mode", "accessoires"],
  },

  // -- Maison : sous-catégories --
  maison: {
    intro: [
      "Tout pour la maison sur Teno Store : meubles, décoration, literie, linge de maison, vaisselle, ustensiles de cuisine, luminaires, tapis, rideaux et accessoires de rangement. Boutiques d'ameublement d'Alger, Oran, Sétif, Constantine et particuliers qui revendent du mobilier en bon état. Prix en dinars algériens (DZD).",
      "La catégorie couvre aussi bien le mobilier neuf des grandes enseignes algériennes que des pièces artisanales (mobilier en bois sculpté de Constantine, dinanderie de Tlemcen, tapis berbères de Ghardaïa et des Aurès). Pour les gros meubles, vérifiez avec le vendeur les modalités de livraison et de montage — la livraison à l'étage et le montage sont souvent payants en sus.",
    ],
    faq: [
      {
        q: "Les meubles sont-ils livrés montés ou en kit ?",
        a: "Dépend du vendeur et du produit. Les meubles fabriqués localement (chambres à coucher, salons, cuisines équipées) sont généralement livrés et montés par l'équipe du vendeur. Les meubles importés en kit (style IKEA) sont livrés à plat avec notice de montage — comptez de 2 000 à 8 000 DZD si vous demandez le montage à domicile.",
      },
      {
        q: "Comment vérifier la qualité d'un meuble en bois ?",
        a: "Vérifiez s'il s'agit de bois massif (hêtre, chêne, noyer) ou de panneaux de particules plaqués. Le bois massif est plus lourd, présente un grain naturel sur les chants, et résiste mieux dans le temps. Les particules sont moins chères mais craignent l'humidité et se dégradent en cas de démontage répété.",
      },
      {
        q: "Les tapis sont-ils en laine véritable ?",
        a: "Les tapis berbères traditionnels (Aurès, Ghardaïa, M'zab) sont noués main en laine de mouton — vérifiez la souplesse de la fibre, la régularité des nœuds au dos, et l'odeur naturelle de la laine. Les tapis industriels en polypropylène sont moins chers mais beaucoup moins durables et moins isolants thermiquement.",
      },
    ],
    related: ["decoration", "salon", "electromenager", "electronique_electromenager"],
  },
  decoration: {
    intro: [
      "Décoration intérieure sur Teno Store : luminaires, tableaux, miroirs, plantes artificielles et vraies, vases, bougies, horloges murales, cadres photo, papiers peints, stickers muraux, tapis décoratifs et objets d'artisanat algérien (poterie de Kabylie, dinanderie de Tlemcen, calligraphie). Vendeurs des principales wilayas, prix en dinars algériens (DZD).",
      "Pour un salon contemporain, comptez à partir de 3 000 DZD pour un cadre déco mural, 8 000 – 25 000 DZD pour un luminaire suspendu de qualité, et 15 000 – 60 000 DZD pour un tapis décoratif selon les dimensions et la matière. Les pièces d'artisanat traditionnel signées sont valorisées et conservent leur valeur dans le temps — privilégiez les ateliers reconnus de Tlemcen, Constantine, Ghardaïa et Béjaïa.",
    ],
    faq: [
      {
        q: "Comment marier les styles modernes et traditionnels dans un salon ?",
        a: "Un canapé contemporain de couleur sobre (gris, beige, marine) se marie très bien avec un tapis berbère ancien, des poteries kabyles ou un service à café en cuivre. La règle classique : un seul élément traditionnel fort par pièce, le reste dans des tons neutres pour le mettre en valeur. Évitez de surcharger.",
      },
      {
        q: "Les luminaires LED valent-ils l'investissement ?",
        a: "Oui : un luminaire LED consomme environ 5 fois moins qu'une ampoule halogène équivalente et dure 15 000 à 25 000 heures. Le surcoût à l'achat est amorti en moins de 2 ans pour un usage quotidien. Vérifiez la température de couleur : 2 700 K pour une ambiance chaude type salon, 4 000 K pour la cuisine et la salle de bain.",
      },
      {
        q: "Comment expédier un objet décoratif fragile vers une autre wilaya ?",
        a: "Demandez au vendeur de bien emballer la pièce (papier bulle, calage en mousse, carton double cannelure) et privilégiez une compagnie de livraison qui propose une assurance casse. Pour les pièces de valeur (vases, miroirs grand format), il est parfois plus sûr de se faire livrer en main propre lors d'un déplacement.",
      },
    ],
    related: ["maison", "salon", "vetements_mode"],
  },
  salon: {
    intro: [
      "Mobilier et décoration de salon sur Teno Store : canapés, fauteuils, tables basses, meubles TV, bibliothèques, salles à manger, salons marocains et algériens traditionnels (banquettes, coussins, dressing). Boutiques d'Alger, Oran, Sétif, Constantine et fabricants locaux. Prix en dinars algériens (DZD).",
      "Pour un salon européen complet (canapé d'angle, deux fauteuils, table basse, meuble TV), comptez de 150 000 DZD pour de l'entrée de gamme à plus de 600 000 DZD pour un ensemble en cuir véritable. Un salon marocain traditionnel sur mesure (banquettes en U avec coussins, table en bois sculpté) se situe entre 120 000 et 400 000 DZD selon les dimensions de la pièce, les tissus choisis et la qualité de la sculpture.",
    ],
    faq: [
      {
        q: "Quelles dimensions prévoir pour un canapé d'angle ?",
        a: "Mesurez la longueur du mur où il sera installé, en tenant compte des portes et des fenêtres. Pour 4 places confortables, comptez 280 à 320 cm sur le grand côté et 180 à 220 cm sur le retour. Vérifiez aussi la largeur des accès (porte d'entrée, cage d'escalier, ascenseur) avant la commande — un canapé qui ne passe pas est un problème courant.",
      },
      {
        q: "Tissu, simili-cuir ou cuir véritable ?",
        a: "Le tissu est le plus économique et chaleureux mais marque davantage les taches ; choisissez-le déhoussable si possible. Le simili-cuir est facile à entretenir mais s'écaille au bout de 3 à 6 ans. Le cuir véritable est le plus durable (15 ans et plus) et prend une belle patine, mais coûte 2 à 3 fois plus cher et craint les griffures d'animaux.",
      },
      {
        q: "Combien de temps pour fabriquer un salon sur mesure ?",
        a: "Comptez généralement 3 à 8 semaines de fabrication selon la complexité, la disponibilité du tissu et la charge de travail de l'artisan. Un acompte de 30 à 50 % est habituel à la commande. Demandez un délai écrit et une description précise des matériaux (essence du bois, densité de la mousse, type de tissu) avant de signer.",
      },
    ],
    related: ["maison", "decoration", "electromenager"],
  },

  // -- Véhicules : sous-catégories --
  vehicules: {
    intro: [
      "Véhicules en tout genre sur Teno Store : voitures particulières, utilitaires, motos, scooters, camions, tracteurs agricoles, remorques, ainsi que les pièces détachées et accessoires automobiles. Toutes les wilayas d'Algérie sont représentées — Alger, Oran, Constantine, Annaba, Sétif, Blida, Béjaïa, Tlemcen, Tizi Ouzou. Prix en dinars algériens (DZD).",
      "Avant tout achat d'un véhicule d'occasion, vérifiez systématiquement la carte grise (au nom du vendeur et sans gage), la concordance des numéros de châssis et de moteur avec ceux indiqués sur la carte grise, et un contrôle technique en cours de validité. Demandez aussi le carnet d'entretien et faites contrôler le véhicule par un mécanicien indépendant avant le paiement final.",
    ],
    faq: [
      {
        q: "Quels documents le vendeur doit-il fournir lors de la cession ?",
        a: "La carte grise originale barrée, datée et signée par le vendeur, un certificat de cession en deux exemplaires, et un quitus fiscal (certificat de non-gage) attestant qu'aucune opposition n'est inscrite sur le véhicule. Pour les véhicules récents encore sous garantie constructeur, demandez aussi le carnet d'entretien et les factures.",
      },
      {
        q: "Combien de temps pour changer la carte grise à son nom ?",
        a: "Le nouveau propriétaire dispose en principe d'un délai (généralement 30 jours après la date de cession) pour faire la déclaration au service des immatriculations de sa wilaya. Renseignez-vous auprès de votre Daïra pour la liste des pièces à fournir et les délais en vigueur — les procédures et tarifs peuvent évoluer.",
      },
      {
        q: "Comment vérifier qu'un kilométrage n'a pas été trafiqué ?",
        a: "Comparez le kilométrage affiché au compteur avec les mentions des derniers contrôles techniques (sur le procès-verbal) et avec les factures d'entretien dans le carnet. Un véhicule de 10 ans avec moins de 80 000 km mérite des questions, surtout si les sièges, le volant et les pédales montrent une usure incompatible avec ce kilométrage.",
      },
    ],
    related: ["voitures", "motos", "automobiles_vehicules"],
  },
  voitures: {
    intro: [
      "Voitures neuves et d'occasion sur Teno Store : citadines, berlines, SUV, breaks, 4x4, voitures de collection. Marques européennes (Renault, Peugeot, Citroën, Dacia, Volkswagen, Skoda, Opel), asiatiques (Toyota, Hyundai, Kia, Nissan, Suzuki, Mitsubishi), allemandes premium (BMW, Mercedes-Benz, Audi) et chinoises (Chery, Geely, MG). Prix en dinars algériens (DZD).",
      "Le marché algérien de l'occasion est très actif : une Symbol/Logan de moins de 10 ans en bon état se situe entre 900 000 et 1 700 000 DZD, une Clio récente entre 1 500 000 et 2 800 000 DZD, un SUV compact (Duster, Sportage, Tucson) entre 2 500 000 et 4 500 000 DZD selon l'âge. Les véhicules importés neufs sont vendus par les concessionnaires officiels et leur disponibilité dépend des quotas d'importation.",
      "Au-delà du prix, regardez la motorisation (essence/diesel/GPL), le kilométrage, l'historique d'entretien et l'origine (Algérie ou import). Une voiture entretenue régulièrement chez un même concessionnaire avec carnet à jour vaut significativement plus qu'un véhicule sans historique, même à kilométrage égal.",
    ],
    faq: [
      {
        q: "Essence, diesel ou GPL : que choisir aujourd'hui ?",
        a: "Le GPL reste très avantageux en Algérie grâce à un prix au litre bas et à des stations bien implantées dans le nord. Le diesel garde l'avantage sur les longues distances et la consommation. L'essence reste le choix simple pour un usage urbain modéré. Pour les véhicules récents, vérifiez si la carte grise mentionne la double énergie GPL.",
      },
      {
        q: "Comment se passe un essai routier avant achat ?",
        a: "Demandez à conduire le véhicule sur 15 – 20 km en variant les conditions (ville, voie rapide, démarrages à froid). Testez les vitesses, le freinage, la direction, la climatisation, les vitres électriques, les essuie-glaces. Écoutez les bruits anormaux. Idéalement, faites cet essai après une nuit de stationnement pour vérifier le démarrage à froid.",
      },
      {
        q: "Faut-il un certificat de non-gage avant l'achat ?",
        a: "Oui — exigez-le systématiquement. Il atteste qu'aucune opposition (crédit non remboursé, contravention impayée, litige) n'est inscrite sur le véhicule. Sans ce document, le changement de carte grise sera bloqué et vous pourriez vous retrouver responsable de dettes liées au véhicule.",
      },
      {
        q: "Les voitures importées récemment ont-elles des garanties différentes ?",
        a: "Une voiture neuve achetée chez un concessionnaire agréé en Algérie bénéficie de la garantie constructeur officielle (généralement 3 à 5 ans selon la marque) et du SAV national. Un véhicule importé en parallèle peut avoir une garantie limitée à celle du vendeur intermédiaire ; vérifiez bien les conditions par écrit avant d'acheter.",
      },
    ],
    related: ["vehicules", "motos", "automobiles_vehicules"],
  },
  motos: {
    intro: [
      "Motos et scooters sur Teno Store : scooters urbains 50 et 125 cm³, motos routières, sportives, trails, customs, motos cross et enduros, ainsi que les équipements pilote (casques, gants, bottes, blousons) et pièces détachées. Marques présentes en Algérie : Yamaha, Honda, Suzuki, Kawasaki, KTM, VMS, Tasluja, ainsi que les marques chinoises de motos utilitaires.",
      "Repères de prix (mai 2026) : un scooter 50 cm³ neuf d'entrée de gamme autour de 180 000 – 280 000 DZD, un scooter 125 cm³ entre 320 000 et 550 000 DZD, une moto routière 250 cm³ entre 450 000 et 800 000 DZD, et une sportive 600 cm³ d'occasion entre 800 000 et 1 800 000 DZD selon l'année et l'état. L'équipement homologué de sécurité (casque intégral, blouson avec protections, gants) coûte 25 000 – 80 000 DZD complet.",
    ],
    faq: [
      {
        q: "Faut-il un permis spécifique pour conduire une moto en Algérie ?",
        a: "Les règles du permis varient selon la cylindrée. Renseignez-vous auprès de votre Daïra ou d'une auto-école pour connaître les catégories en vigueur et les conditions d'obtention. Quoi qu'il en soit, conduire sans le permis correspondant à la cylindrée vous expose à des sanctions et à un refus d'indemnisation en cas d'accident.",
      },
      {
        q: "Quel équipement de sécurité est indispensable ?",
        a: "Un casque homologué (de préférence intégral, plus protecteur qu'un jet), un blouson avec protections aux épaules, coudes et dos, des gants renforcés, et des chaussures montantes qui couvrent les chevilles. Pour les longs trajets ou la moto sportive, un pantalon renforcé et une dorsale rigide complètent l'équipement.",
      },
      {
        q: "Comment vérifier l'état d'une moto d'occasion ?",
        a: "Inspectez la chaîne et les pignons (usure, jeu), l'état des pneus (date de fabrication, profondeur de sculpture), les disques de frein (épaisseur, voile), la fourche (fuites d'huile), et le faisceau électrique. Démarrez à froid pour écouter le moteur et regarder la fumée à l'échappement. Demandez l'historique d'entretien et la carte grise au nom du vendeur.",
      },
    ],
    related: ["vehicules", "voitures", "automobiles_vehicules", "accessoires"],
  },

  // -- Immobilier --
  immobilier: {
    intro: [
      "Annonces immobilières en Algérie sur Teno Store : appartements, villas, terrains, locaux commerciaux, bureaux, garages, en vente ou en location. Toutes les wilayas sont couvertes — Alger, Oran, Constantine, Annaba, Sétif, Blida, Tipaza, Boumerdès, Béjaïa, Tlemcen. Prix en dinars algériens (DZD), surface en mètres carrés et nombre de pièces (F2, F3, F4, F5) indiqués dans chaque annonce.",
      "Les fourchettes de prix varient énormément selon la wilaya et le quartier. Pour donner un ordre d'idée à Alger en 2026 : un F3 à Bab Ezzouar ou Bordj El Kiffan se négocie autour de 18 – 28 millions DZD, le même F3 à Hydra ou Ben Aknoun peut dépasser 50 millions DZD. À Oran, Constantine ou Annaba, les prix sont généralement 30 à 50 % inférieurs à ceux d'Alger pour des surfaces équivalentes. La location d'un F3 se situe entre 35 000 et 90 000 DZD/mois selon la wilaya et le quartier.",
      "Pour la vente, exigez systématiquement de voir l'acte de propriété notarié (livret foncier ou acte authentique) avant tout versement, et faites vérifier les documents par un notaire indépendant. Pour la location, signez un contrat écrit précisant la durée, le montant du loyer, les charges, et l'état des lieux d'entrée.",
    ],
    faq: [
      {
        q: "Quels documents le vendeur doit-il présenter ?",
        a: "L'acte de propriété (acte notarié ou livret foncier au nom du vendeur), un certificat négatif d'hypothèque, le permis de construire si le bien a été récemment édifié, et un certificat de conformité urbanistique. En cas d'indivision (héritage), tous les indivisaires doivent figurer à l'acte. Faites toujours vérifier ces pièces par un notaire avant la signature de la promesse de vente.",
      },
      {
        q: "Promesse de vente, compromis, acte authentique : quelles différences ?",
        a: "La promesse de vente engage le vendeur à vendre à un prix convenu pendant un délai donné, en échange d'une indemnité d'immobilisation. L'acte authentique de vente, signé devant notaire, est l'acte définitif qui transfère la propriété. Toute somme remise doit être consignée chez le notaire ou faire l'objet d'un reçu signé. N'engagez pas de fonds importants sans cadre notarié.",
      },
      {
        q: "Acheter sur plan (VEFA) : quelles précautions ?",
        a: "Vérifiez le permis de construire et l'autorisation de vente sur plan du promoteur. Demandez le règlement de copropriété, le descriptif technique, le délai de livraison contractuel et les pénalités de retard. Échelonnez les paiements selon l'avancement des travaux (fondations, gros œuvre, second œuvre, livraison) et conservez tous les reçus.",
      },
      {
        q: "Location : quelle durée de bail et quelle caution ?",
        a: "La durée d'un bail d'habitation est généralement de 1 à 3 ans renouvelables, à négocier avec le propriétaire. La caution demandée représente le plus souvent 1 à 3 mois de loyer ; elle doit être mentionnée par écrit dans le contrat et restituée à la sortie après état des lieux contradictoire. Pour toute question juridique précise, consultez un notaire ou un avocat.",
      },
    ],
    related: ["maison", "services"],
  },

  // -- Jeux & Loisirs --
  jeux: {
    intro: [
      "Jeux, loisirs et culture sur Teno Store : consoles de jeux (PlayStation 4 et 5, Xbox Series, Nintendo Switch), jeux vidéo, accessoires gaming, jouets pour enfants, jeux de société, livres, instruments de musique, articles de pêche et de chasse. Vendeurs particuliers et boutiques spécialisées d'Alger, Oran, Constantine et autres wilayas. Prix en dinars algériens (DZD).",
      "Repères de prix (mai 2026) : une PS5 standard neuve autour de 110 000 – 140 000 DZD, une PS4 Pro d'occasion entre 45 000 et 70 000 DZD, une Nintendo Switch OLED autour de 60 000 – 80 000 DZD. Les jeux physiques récents se situent entre 4 000 et 9 000 DZD, les éditions anciennes ou d'occasion à partir de 1 500 DZD. Les manettes officielles supplémentaires coûtent 8 000 – 18 000 DZD selon le modèle.",
    ],
    faq: [
      {
        q: "Comment vérifier qu'une console d'occasion n'est pas modifiée ?",
        a: "Demandez au vendeur de démarrer la console devant vous, vérifiez le numéro de série dans les paramètres système, et assurez-vous que la console se connecte au PSN, Xbox Live ou Nintendo eShop avec un compte test. Une console « jailbreakée » ne peut généralement plus se connecter au store officiel et peut être bannie du réseau en ligne.",
      },
      {
        q: "Les jeux sont-ils en français ?",
        a: "La majorité des jeux récents proposent le français dans les options de langue, mais certaines éditions importées (notamment d'Asie ou des États-Unis) sont limitées à l'anglais. Vérifiez auprès du vendeur la langue de l'interface et des sous-titres avant l'achat, surtout pour les jeux d'aventure et les RPG très narratifs.",
      },
      {
        q: "Les jouets pour enfants sont-ils conformes aux normes de sécurité ?",
        a: "Privilégiez les jouets portant le marquage CE et indiquant clairement l'âge recommandé. Méfiez-vous des copies de marques (Lego, Playmobil) à prix très bas, qui peuvent contenir des petites pièces non conformes ou des matériaux non testés. Pour les enfants de moins de 3 ans, évitez les jouets avec petites pièces détachables.",
      },
    ],
    related: ["informatique", "bebe", "sport", "electronique_electromenager"],
  },

  // -- Bébé & Enfants --
  bebe: {
    intro: [
      "Tout pour bébé et enfants sur Teno Store : poussettes, sièges auto, lits et berceaux, table à langer, chaises hautes, vêtements 0-2 ans et 2-12 ans, jouets éducatifs, biberons, couches, articles de puériculture, et matériel scolaire. Vendeurs établis dans toutes les wilayas, prix en dinars algériens (DZD).",
      "Pour l'équipement de naissance complet (lit, poussette, siège auto, table à langer, baignoire, biberons), comptez un budget de 60 000 à 150 000 DZD selon les marques. Un siège auto homologué groupe 0/1 (de la naissance à 4 ans environ) se situe entre 12 000 et 35 000 DZD. Une poussette poussant correctement sur les trottoirs algériens (roues moyennes ou grandes) entre 18 000 et 50 000 DZD.",
    ],
    faq: [
      {
        q: "Comment choisir un siège auto adapté à l'âge de l'enfant ?",
        a: "Les sièges auto sont classés en groupes selon le poids et l'âge : groupe 0+ (jusqu'à 13 kg, dos à la route), groupe 1 (9-18 kg), groupe 2/3 (15-36 kg, rehausseur). Privilégiez les sièges aux normes ECE R44/04 ou R129 (i-Size). Installez-le toujours selon la notice et vérifiez régulièrement la tension des sangles.",
      },
      {
        q: "Vêtements d'occasion pour bébé : est-ce une bonne idée ?",
        a: "Oui — les bébés grandissent vite et portent souvent peu chaque taille. Lavez systématiquement à 60 °C avant la première utilisation. Vérifiez l'absence de boutons mal cousus, de fermetures éclair défectueuses ou de petites pièces décoratives qui pourraient se détacher. Évitez en revanche les pyjamas anti-feu très anciens, dont les traitements peuvent être déconseillés.",
      },
      {
        q: "Quels jouets pour quel âge ?",
        a: "0-6 mois : hochets, tapis d'éveil, mobiles. 6-12 mois : jouets à empiler, à mâchouiller, livres en tissu. 1-3 ans : jeux d'encastrement, premières voitures, peluches. 3-6 ans : puzzles, jeux de rôle, dessin. Les indications d'âge sur l'emballage sont importantes : un jouet « 3 ans et plus » contient souvent de petites pièces dangereuses pour un plus jeune.",
      },
    ],
    related: ["jeux", "mode", "vetements_mode", "maison"],
  },

  // -- Sport --
  sport: {
    intro: [
      "Équipements de sport et loisirs sur Teno Store : vêtements et chaussures de sport, articles de musculation et fitness (haltères, tapis, vélos d'appartement), articles de football (maillots officiels et répliques, ballons, crampons), vélos VTT et de route, équipements de natation, randonnée, camping, pêche et chasse. Marques internationales (Nike, Adidas, Puma, Decathlon, Quechua) et marques locales.",
      "Repères de prix (mai 2026) : un vélo VTT d'entrée de gamme autour de 35 000 – 55 000 DZD, un vélo VTT semi-rigide milieu de gamme entre 80 000 et 150 000 DZD. Un tapis de course pliable pour la maison entre 60 000 et 130 000 DZD, un vélo d'appartement entre 30 000 et 80 000 DZD. Un maillot officiel d'équipe de football européenne authentique se situe entre 6 000 et 12 000 DZD ; les répliques bon marché à 2 000 DZD sont presque toujours des contrefaçons.",
    ],
    faq: [
      {
        q: "Comment vérifier l'authenticité d'un maillot de football ?",
        a: "Vérifiez les coutures (régulières, sans fils qui dépassent), la qualité du flocage (chiffres et lettres bien thermocollés, non décollables à l'ongle), la présence d'une étiquette intérieure avec composition et numéro de série, et croisez le modèle avec le site officiel de la marque. Un prix anormalement bas (-70 %) est un signal clair de contrefaçon.",
      },
      {
        q: "Quel vélo pour les routes algériennes ?",
        a: "Pour un usage mixte ville-campagne, un VTT semi-rigide (suspension avant uniquement) avec des pneus de 27,5 ou 29 pouces est polyvalent et résistant aux nids-de-poule. Pour la route uniquement et le sport, un vélo de route en aluminium est plus rapide mais nécessite un revêtement de qualité. Vérifiez la disponibilité des pièces (chambres à air, freins, cassette) chez votre vendeur.",
      },
      {
        q: "Faut-il un équipement spécial pour la salle de sport ?",
        a: "Pour commencer : une paire de chaussures à semelle plate et stable pour les exercices au poids du corps et avec haltères, des vêtements en matière technique respirante, une serviette et une bouteille d'eau. Des gants de musculation et une ceinture de force ne sont utiles qu'à partir de charges importantes ou pour les blessures antérieures.",
      },
    ],
    related: ["mode", "vetements_mode", "jeux", "accessoires"],
  },

  // -- Services --
  services: {
    intro: [
      "Annonces de services en Algérie sur Teno Store : services à domicile (ménage, garde d'enfants, jardinage), travaux et rénovation (plomberie, électricité, peinture, menuiserie, climatisation), services informatiques (dépannage PC, installation réseau, création de sites), cours particuliers, transport, déménagement, organisation d'événements. Prestataires établis dans toutes les wilayas, tarifs en dinars algériens (DZD).",
      "Pour les travaux et la rénovation, demandez plusieurs devis détaillés écrits avant de choisir un prestataire — un devis doit préciser la nature des travaux, les matériaux fournis, la main-d'œuvre, le délai d'exécution et les conditions de paiement (acompte, solde). Pour les cours particuliers, le tarif horaire varie selon le niveau (collège, lycée, université, langues) et se situe généralement entre 800 et 3 000 DZD de l'heure.",
    ],
    faq: [
      {
        q: "Comment choisir un artisan fiable pour des travaux ?",
        a: "Privilégiez les artisans qui peuvent montrer des photos de chantiers précédents et fournir des références de clients récents. Demandez un devis détaillé écrit, signé et daté, avec ventilation matériaux/main-d'œuvre. Pour les gros chantiers (rénovation complète), échelonnez les paiements selon l'avancement plutôt que de tout payer à l'avance.",
      },
      {
        q: "Faut-il signer un contrat pour une prestation de service ?",
        a: "Pour toute prestation supérieure à quelques milliers de DZD ou s'étalant sur plusieurs jours, un document écrit (devis accepté, bon de commande, contrat simple) protège les deux parties. Il doit préciser l'objet, le prix, le délai, et les conditions en cas de non-conformité. Conservez les échanges écrits (SMS, WhatsApp, mail) en complément.",
      },
      {
        q: "Comment se passe le paiement d'un service ?",
        a: "Le mode le plus courant en Algérie est l'espèces, parfois avec un acompte à la commande et le solde à la livraison ou à la fin du chantier. Certains prestataires acceptent le virement bancaire ou les paiements via les solutions locales. Demandez toujours un reçu signé indiquant la prestation, le montant et la date.",
      },
    ],
    related: ["emploi", "maison", "informatique"],
  },

  // -- Emploi --
  emploi: {
    intro: [
      "Offres et demandes d'emploi en Algérie sur Teno Store : CDI, CDD, missions freelance, stages, alternance, jobs étudiants et offres pour cadres et techniciens. Tous les secteurs sont représentés : informatique et développement, BTP, commerce et vente, restauration et hôtellerie, transport et logistique, santé, enseignement, services à la personne. Annonces de la part d'entreprises et de recruteurs particuliers dans toutes les wilayas.",
      "Pour les candidats, préparez un CV à jour (idéalement en français et en arabe, parfois en anglais pour les postes techniques internationaux) et une lettre de motivation adaptée à chaque offre. Pour les recruteurs, décrivez précisément le poste, les missions, le profil recherché, la fourchette de salaire si possible, et le lieu de travail — les annonces complètes attirent les meilleures candidatures.",
    ],
    faq: [
      {
        q: "Comment éviter les offres d'emploi frauduleuses ?",
        a: "Méfiez-vous des offres demandant le paiement d'une « caution », « formation payante » ou « frais de dossier » avant l'embauche — une vraie offre d'emploi ne demande jamais d'argent au candidat. Vérifiez l'existence réelle de l'entreprise (adresse, registre de commerce). Pour les offres à l'étranger, soyez particulièrement prudent et croisez avec des sources officielles.",
      },
      {
        q: "Quels documents prévoir lors d'un entretien d'embauche ?",
        a: "CV à jour, copies des diplômes (originaux à présenter sur demande), pièce d'identité, attestation d'expérience des employeurs précédents si disponible, et éventuellement un portfolio pour les métiers créatifs ou techniques. Renseignez-vous sur l'entreprise avant l'entretien et préparez quelques questions à poser au recruteur.",
      },
      {
        q: "CDI, CDD, freelance : quelles différences en pratique ?",
        a: "Le CDI offre la sécurité du long terme et l'accès aux prestations sociales complètes. Le CDD répond à un besoin temporaire et a une date de fin connue d'avance. Le travail freelance offre plus de flexibilité mais demande une organisation autonome (déclaration d'activité, facturation, cotisations). Le statut adapté dépend de votre situation personnelle et de vos objectifs.",
      },
    ],
    related: ["services", "informatique"],
  },
};

const GENERIC_FAQ: CategoryFaqItem[] = [
  {
    q: "Les prix sont-ils en dinars algériens ?",
    a: "Oui. Tous les prix affichés sur Teno Store sont en dinars algériens (DZD).",
  },
  {
    q: "Comment contacter le vendeur ?",
    a: "Chaque annonce affiche les coordonnées du vendeur — numéro de téléphone, WhatsApp ou Viber. Cliquez sur le bouton de contact pour ouvrir une conversation directe.",
  },
  {
    q: "Teno Store accepte-t-il les achats par agent IA ?",
    a: "Oui. Teno Store est conçu nativement comme un marketplace agent-à-agent. Les agents IA peuvent découvrir, comparer et acheter via les protocoles MCP, A2A et AP2.",
  },
];

export function getCategoryContent(slug: string): CategoryContent {
  const entry = CONTENT[slug.toLowerCase()];
  if (entry) return entry;
  // Fallback for slugs we haven't enriched: generate a templated intro from
  // the humanized label. Still indexable, still distinct from /search, but
  // light on prose. Add the slug to CONTENT above to upgrade.
  const human = humanizeCategorySlug(slug);
  const humanLower = human.toLowerCase();
  return {
    intro: [
      `Annonces ${humanLower} de vendeurs algériens sur Teno Store — neuf et occasion, prix en dinars algériens (DZD), wilayas affichées sur chaque annonce. Le catalogue est actualisé en continu : les annonces reflètent ce qui est réellement disponible à l'instant présent.`,
      `Utilisez les filtres ci-dessous pour cibler par marque, prix ou vendeur. Chaque annonce affiche un indicateur de risque de contrefaçon, les coordonnées du vendeur, et un lien vers sa boutique complète.`,
    ],
    faq: GENERIC_FAQ,
    related: [],
  };
}

export function hasCategoryContent(slug: string): boolean {
  return Boolean(CONTENT[slug.toLowerCase()]);
}
