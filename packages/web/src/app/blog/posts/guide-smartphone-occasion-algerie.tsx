import Link from "next/link";
import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "guide-achat-smartphone-occasion-algerie-2026",
  title: "Guide d'achat : choisir un smartphone d'occasion en Algérie (2026)",
  description:
    "Comment acheter un smartphone d'occasion en Algérie sans se faire avoir — vérifications IMEI, prix de référence en DZD, signes de contrefaçon, et où regarder.",
  category: "Guides d'achat",
  datePublished: "2026-05-13",
  dateModified: "2026-05-13",
  excerpt:
    "Le marché de l'occasion en Algérie est riche — mais aussi piégé. Voici comment repérer une bonne affaire, écarter les contrefaçons, et acheter en confiance.",
  readingMinutes: 7,
  Body() {
    return (
      <>
        <p className="lead">
          Acheter un smartphone d&rsquo;occasion en Algérie, c&rsquo;est souvent
          la seule façon de mettre la main sur un modèle récent à un prix
          raisonnable. Mais entre les copies, les téléphones volés, et les
          vendeurs qui gonflent l&rsquo;état réel de l&rsquo;appareil, il faut
          savoir où regarder. Ce guide rassemble les vérifications que font les
          acheteurs expérimentés avant de payer.
        </p>

        <h2>1. Fixer un budget réaliste en DZD</h2>
        <p>
          Les prix de l&rsquo;occasion en Algérie suivent ceux du neuf importé,
          avec une décote qui dépend surtout de l&rsquo;âge du modèle et de
          l&rsquo;état esthétique. À titre indicatif (mai 2026, marché
          algérois) :
        </p>
        <ul>
          <li>
            <strong>iPhone 13 / 13 Pro</strong> en bon état : 75 000 – 110 000
            DZD selon le stockage.
          </li>
          <li>
            <strong>Samsung Galaxy S22 / S23</strong> : 55 000 – 95 000 DZD.
          </li>
          <li>
            <strong>Xiaomi / Redmi Note 12-13</strong> : 25 000 – 45 000 DZD.
          </li>
          <li>
            <strong>Modèles d&rsquo;entrée de gamme récents</strong> (Itel,
            Tecno, Infinix) : 12 000 – 25 000 DZD.
          </li>
        </ul>
        <p>
          Avant de négocier, parcourez plusieurs annonces du même modèle pour
          calibrer votre prix cible. Sur{" "}
          <Link href="/c/telephones">
            la catégorie téléphones de Teno Store
          </Link>
          , les filtres par marque et fourchette de prix permettent de
          construire une référence en quelques minutes.
        </p>

        <h2>2. Vérifier l&rsquo;IMEI — la seule preuve qui ne ment pas</h2>
        <p>
          L&rsquo;IMEI est le numéro de série unique de chaque téléphone. C&rsquo;est
          le premier réflexe avant tout paiement. Demandez au vendeur de
          composer <code>*#06#</code> sur l&rsquo;appareil, et notez les 15
          chiffres qui s&rsquo;affichent. Ensuite :
        </p>
        <ul>
          <li>
            Vérifiez sur un service comme <em>imei.info</em> ou{" "}
            <em>swappa.com/esn</em> que la marque, le modèle et le stockage
            correspondent à l&rsquo;annonce.
          </li>
          <li>
            Pour les iPhones, l&rsquo;outil de vérification de garantie Apple
            (<em>checkcoverage.apple.com</em>) indique si l&rsquo;appareil est
            encore sous garantie et s&rsquo;il a été activé.
          </li>
          <li>
            Un IMEI introuvable ou commençant par <code>0000</code> est presque
            toujours une copie. Refusez.
          </li>
        </ul>

        <h2>3. Repérer une contrefaçon en 30 secondes</h2>
        <p>
          Les copies algériennes sont devenues très convaincantes
          visuellement. Trois tests rapides à faire en main :
        </p>
        <ol>
          <li>
            <strong>Le poids.</strong> Un iPhone 13 pèse 174 g, un Galaxy S22
            167 g. Une copie est presque toujours plus légère (plastique au
            lieu d&rsquo;aluminium / verre).
          </li>
          <li>
            <strong>L&rsquo;écran.</strong> Activez la fonction zoom dans les
            réglages et zoomez sur du texte. Sur une copie, les sous-pixels
            sont visibles à l&rsquo;œil nu ; sur un original, l&rsquo;image
            reste nette.
          </li>
          <li>
            <strong>Les apps système.</strong> Sur iPhone, ouvrez l&rsquo;App
            Store et essayez de télécharger une app. Les copies tournent sous
            Android camouflé en iOS et l&rsquo;App Store ne fonctionne pas.
            Sur Android, vérifiez la version exacte dans Réglages → À propos —
            une version qui ne correspond pas à celle annoncée par le
            constructeur est suspecte.
          </li>
        </ol>
        <p>
          Sur Teno Store, chaque annonce porte un{" "}
          <strong>indicateur de risque de contrefaçon</strong> visible —
          c&rsquo;est l&rsquo;une des raisons d&rsquo;avoir lancé la
          plateforme. Les annonces marquées comme suspectes ou en cours de
          vérification sont signalées clairement avant que vous contactiez le
          vendeur.
        </p>

        <h2>4. Rencontrer en lieu sûr</h2>
        <p>
          Préférez toujours une rencontre publique pour finaliser : un centre
          commercial, un café, ou la boutique du vendeur si c&rsquo;est un
          professionnel. Vérifiez l&rsquo;appareil en présence du vendeur :
          allumage, déverrouillage, photo, appel test, Wi-Fi, Bluetooth,
          chargement. Ne payez qu&rsquo;après ces vérifications.
        </p>

        <h2>5. Garder une trace écrite</h2>
        <p>
          Demandez une preuve d&rsquo;achat — même informelle, un SMS ou un
          message WhatsApp avec le numéro IMEI, le prix, et la date suffit. En
          cas de litige ou de vol déclaré ultérieurement, c&rsquo;est ce qui
          vous protège.
        </p>

        <h2>Et après ?</h2>
        <p>
          Si vous cherchez un modèle précis, le plus rapide est de filtrer par
          marque sur <Link href="/c/telephones">Teno Store</Link>
          {" "}— le catalogue est actualisé en continu, et chaque annonce affiche
          le wilaya du vendeur pour limiter les trajets. Pour les vendeurs
          parmi vous, notre prochain article couvre les sept conseils
          essentiels pour rédiger des annonces qui se vendent vraiment.
        </p>
      </>
    );
  },
};
