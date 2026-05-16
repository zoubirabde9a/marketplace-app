import Link from "next/link";
import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "acheter-voiture-occasion-algerie-10-verifications",
  title: "Acheter une voiture d'occasion en Algérie : 10 vérifications avant de payer",
  description:
    "Carte grise, contrôle technique, kilométrage, négociation : la checklist complète pour acheter une voiture d'occasion en Algérie sans mauvaise surprise.",
  category: "Guides d'achat",
  datePublished: "2026-05-13",
  dateModified: "2026-05-13",
  excerpt:
    "Le marché de l'occasion automobile en Algérie est tendu et les arnaques fréquentes. Voici les dix vérifications à faire systématiquement avant de remettre le moindre dinar.",
  readingMinutes: 9,
  Body() {
    return (
      <>
        <p className="lead">
          Avec la fermeture progressive des importations de véhicules neufs ces
          dernières années, le marché de l&rsquo;occasion en Algérie a explosé
          — et les prix avec. Une citadine populaire d&rsquo;il y a 7-8 ans
          peut dépasser les 300 millions de centimes, une compacte récente
          flirte avec les 500. À ces niveaux,
          une vérification bâclée coûte cher. Voici les dix points à contrôler
          systématiquement, dans l&rsquo;ordre, avant de payer.
        </p>

        <h2>1. La carte grise : le document qui prime sur tout</h2>
        <p>
          Première chose à demander, avant même de voir la voiture : une photo
          recto-verso de la carte grise. Vérifiez :
        </p>
        <ul>
          <li>
            Le <strong>nom du propriétaire</strong> correspond bien à la
            personne qui vous reçoit (carte d&rsquo;identité à l&rsquo;appui).
            Sinon, exigez une procuration légalisée.
          </li>
          <li>
            Le <strong>numéro de châssis</strong> (numéro VIN) sur la carte
            grise correspond à celui frappé sous le capot et derrière le
            pare-brise côté conducteur.
          </li>
          <li>
            La <strong>date de première mise en circulation</strong>, le nombre
            de propriétaires précédents, et l&rsquo;absence de mention
            «&nbsp;gage&nbsp;» ou «&nbsp;opposition&nbsp;».
          </li>
        </ul>
        <p>
          Une carte grise plastifiée illisible ou «&nbsp;en cours de
          renouvellement&nbsp;» est un drapeau rouge. N&rsquo;avancez pas tant
          que le document original n&rsquo;est pas physiquement entre vos
          mains.
        </p>

        <h2>2. Le contrôle technique en cours de validité</h2>
        <p>
          Le contrôle technique (CT) est obligatoire en Algérie pour tout
          véhicule de plus de quatre ans, renouvelable tous les ans. Demandez
          le procès-verbal du dernier CT — il liste les défauts constatés et
          indique si une contre-visite est requise. Un CT effectué la veille de
          la vente est suspect : le vendeur a peut-être choisi un centre
          complaisant. Mieux vaut un CT vieux de six mois dans un centre connu.
        </p>

        <h2>3. Le kilométrage : croisez les sources</h2>
        <p>
          Trafiquer un compteur kilométrique coûte 5 000 DZD à Alger. Croisez
          au moins trois indices :
        </p>
        <ol>
          <li>
            Les <strong>vignettes d&rsquo;entretien</strong> collées sur le
            pare-brise ou dans le carnet (vidanges, courroies de
            distribution) — chaque vignette porte le kilométrage du jour.
          </li>
          <li>
            L&rsquo;<strong>usure du volant, du pommeau de vitesse et des
            pédales</strong>. Un volant lustré sur une voiture annoncée à
            45 000 km est mathématiquement impossible.
          </li>
          <li>
            Les <strong>factures de garage</strong>, si le vendeur les a
            gardées. Un véhicule sérieusement entretenu a une trace écrite.
          </li>
        </ol>

        <h2>4. L&rsquo;essai routier : 20 minutes minimum</h2>
        <p>
          Beaucoup d&rsquo;acheteurs se contentent d&rsquo;un tour du
          pâté de maisons. C&rsquo;est très insuffisant. Roulez vingt minutes
          au minimum, en variant les conditions :
        </p>
        <ul>
          <li>
            Démarrage à froid (moteur éteint depuis plus d&rsquo;une heure) —
            écoutez les claquements et regardez la fumée d&rsquo;échappement.
          </li>
          <li>
            Accélération franche jusqu&rsquo;à 80 km/h — la boîte doit passer
            sans à-coups, le moteur ne doit pas trembler.
          </li>
          <li>
            Freinage d&rsquo;urgence sur route déserte — la voiture doit
            rester en ligne droite. Une déviation = disque voilé ou étrier
            grippé.
          </li>
          <li>
            Volant relâché à 60 km/h sur route plate — la voiture ne doit pas
            tirer d&rsquo;un côté. Sinon, géométrie à refaire (15 000 –
            25 000 DZD).
          </li>
        </ul>

        <h2>5. Sous le capot : les cinq points clés</h2>
        <p>
          Même sans être mécanicien, ouvrez le capot et regardez :
        </p>
        <ul>
          <li>
            <strong>Le niveau et la couleur de l&rsquo;huile</strong> — noire
            et épaisse = vidange en retard ; laiteuse = joint de culasse
            (catastrophe).
          </li>
          <li>
            <strong>Le liquide de refroidissement</strong> doit être propre,
            pas rouillé.
          </li>
          <li>
            <strong>Les durites</strong> ne doivent pas être craquelées.
          </li>
          <li>
            <strong>Les traces de fuite</strong> au sol après avoir laissé la
            voiture cinq minutes au ralenti.
          </li>
          <li>
            <strong>L&rsquo;état de la courroie de distribution</strong> et la
            date du dernier remplacement (à faire tous les 60 000 –
            100 000 km selon le modèle ; coût : 40 000 – 80 000 DZD).
          </li>
        </ul>

        <h2>6. La carrosserie : traces de réparation</h2>
        <p>
          Passez la main sur chaque aile et chaque porte. Une réparation
          masquée se sent au toucher — la peinture n&rsquo;a pas exactement
          la même texture. Vérifiez aussi :
        </p>
        <ul>
          <li>
            L&rsquo;alignement des jeux entre capot, ailes et portes — un jeu
            irrégulier trahit un choc.
          </li>
          <li>
            La couleur des vis de fixation du capot et des portes : une vis
            griffée signifie démontage récent.
          </li>
          <li>
            Le coffre, sous le tapis : tôle gondolée ou peinte récemment =
            choc arrière.
          </li>
        </ul>

        <h2>7. Prix de référence (mai 2026, à titre indicatif)</h2>
        <p>
          Le marché bouge vite ; ces fourchettes sont des repères, pas des
          vérités absolues, pour des modèles en bon état avec un kilométrage
          cohérent :
        </p>
        <ul>
          <li>
            <strong>Berline compacte d&rsquo;entrée de gamme (2015-2017)</strong> :
            110 – 150 millions de centimes.
          </li>
          <li>
            <strong>Citadine populaire récente (2017-2019)</strong> : 230 – 320
            millions.
          </li>
          <li>
            <strong>Compacte européenne récente (2018-2020)</strong> : 400 – 520
            millions.
          </li>
          <li>
            <strong>Mini-citadine asiatique (2018-2020)</strong> : 180 – 240
            millions.
          </li>
          <li>
            <strong>SUV urbain d&rsquo;entrée de gamme (2019-2021)</strong> : 290
            – 360 millions.
          </li>
        </ul>
        <p>
          Avant de négocier, comparez plusieurs annonces du même modèle sur{" "}
          <Link href="/c/voitures">la catégorie voitures de Teno Store</Link>
          {" "}ou plus largement sur la rubrique{" "}
          <Link href="/c/automobiles_vehicules">automobiles et véhicules</Link>
          {" "}— les filtres par wilaya, année et kilométrage construisent une
          référence en quelques minutes.
        </p>

        <h2>8. Vérifier l&rsquo;absence de gage ou d&rsquo;opposition</h2>
        <p>
          Une voiture gagée (achetée à crédit non remboursé) ou frappée
          d&rsquo;opposition (vol, litige judiciaire) ne pourra pas être
          immatriculée à votre nom. La mention apparaît au dos de la carte
          grise et peut être confirmée auprès de la daïra où le véhicule est
          immatriculé. Cinq minutes au guichet, ça évite des mois de procédure.
        </p>

        <h2>9. La négociation : ancrer le prix sur les défauts</h2>
        <p>
          Notez tous les défauts constatés pendant la vérification — pneus
          usés, plaquettes à changer, parechoc rayé, vidange en retard. Estimez
          le coût de remise en état (un garagiste de confiance donne ces
          devis gratuitement en cinq minutes). Présentez ensuite votre offre
          en montrant la liste : c&rsquo;est beaucoup plus efficace que de
          demander «&nbsp;tu peux baisser&nbsp;?&nbsp;» à froid.
        </p>

        <h2>10. Le paiement et l&rsquo;acte de vente</h2>
        <p>
          Ne payez jamais d&rsquo;acompte sans contrat écrit. Le jour de la
          transaction :
        </p>
        <ul>
          <li>
            Rédigez un <strong>acte de vente</strong> en deux exemplaires
            (acheteur / vendeur) mentionnant prix, kilométrage, numéro de
            châssis, et état déclaré.
          </li>
          <li>
            Faites <strong>légaliser les signatures</strong> à l&rsquo;APC —
            c&rsquo;est ce qui rend l&rsquo;acte opposable en cas de litige.
          </li>
          <li>
            Le vendeur signe la carte grise au dos («&nbsp;cédé le …
            à …&nbsp;»). Vous avez ensuite 30 jours pour faire la
            mutation à votre nom.
          </li>
        </ul>

        <h2>Pour aller plus loin</h2>
        <p>
          Si vous n&rsquo;êtes pas mécanicien et que la voiture vous plaît,
          investissez 3 000 – 5 000 DZD pour une expertise indépendante avant
          achat — un garagiste de confiance peut diagnostiquer en 30 minutes
          ce qui prendrait des heures à un amateur. Sur le coût total d&rsquo;une
          voiture à 300 millions, c&rsquo;est la meilleure assurance du
          marché. Pour explorer les annonces actives, commencez par filtrer
          par budget et par wilaya sur{" "}
          <Link href="/c/voitures">la catégorie voitures</Link> — la liste est
          actualisée en continu.
        </p>
      </>
    );
  },
};
