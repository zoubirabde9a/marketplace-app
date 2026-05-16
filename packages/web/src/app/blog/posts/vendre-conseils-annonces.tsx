import Link from "next/link";
import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "vendre-sur-teno-store-7-conseils-annonces",
  title: "Vendre sur Teno Store : 7 conseils pour des annonces qui se vendent",
  description:
    "Photos, titre, prix, description, réactivité : les sept leviers concrets qui font qu'une annonce se vend en 48 h plutôt qu'en 6 semaines.",
  category: "Conseils vendeurs",
  datePublished: "2026-05-13",
  dateModified: "2026-05-13",
  excerpt:
    "Une annonce qui ne se vend pas n'est presque jamais un problème de prix — c'est un problème de présentation. Voici les sept leviers qui font la différence.",
  readingMinutes: 6,
  Body() {
    return (
      <>
        <p className="lead">
          La plupart des vendeurs occasionnels pensent qu&rsquo;une annonce qui
          ne part pas a un problème de prix. Dans 80 % des cas, c&rsquo;est en
          fait un problème de <em>présentation</em> : photos floues, titre
          vague, description trop courte, ou délai de réponse trop long. Voici
          les sept leviers à actionner — par ordre d&rsquo;impact.
        </p>

        <h2>1. Photos : 5 minimum, en lumière du jour</h2>
        <p>
          La photo est ce qui décide si l&rsquo;acheteur clique. Visez cinq
          photos minimum : face, dos, tranche, écran allumé, et un détail
          (port de charge, accessoires, défaut éventuel). Toujours en
          lumière du jour, jamais au flash. Un fond uni — un drap blanc ou la
          table de cuisine — fait paraître l&rsquo;objet professionnel sans
          rien coûter.
        </p>

        <h2>2. Titre : modèle exact, état, capacité</h2>
        <p>
          Un bon titre contient trois informations dans cet ordre : <strong>
          modèle exact</strong>, <strong>capacité ou variante</strong>, <strong>
          état</strong>. Exemple :
        </p>
        <ul>
          <li>
            ❌ &laquo;&nbsp;Smartphone à vendre urgent&nbsp;&raquo;
          </li>
          <li>
            ✅ &laquo;&nbsp;Smartphone haut de gamme récent (256 Go,
            coloris bleu) — très bon état, sous garantie&nbsp;&raquo;
          </li>
        </ul>
        <p>
          Le deuxième titre apparaît dans les recherches qui contiennent
          marque, capacité et garantie. Le premier n&rsquo;apparaît nulle
          part. Indiquez toujours marque, capacité, coloris et état dans le
          titre.
        </p>

        <h2>3. Prix : aligné, pas optimiste</h2>
        <p>
          Avant de publier, ouvrez{" "}
          <Link href="/search">Teno Store</Link> et regardez les trois ou quatre
          annonces actives du même modèle. Votre prix doit être dans cette
          fourchette, légèrement en-dessous si vous voulez une vente rapide.
          Un prix 15 % au-dessus de la moyenne fait que personne ne contacte —
          et après deux semaines sans réponse, vous baisserez de toute façon.
          Autant partir au bon prix.
        </p>

        <h2>4. Description : répondre aux questions avant qu&rsquo;elles soient posées</h2>
        <p>
          Une bonne description évite la moitié des messages
          &laquo;&nbsp;encore disponible&nbsp;?&nbsp;&raquo; en donnant tout
          d&rsquo;avance. Incluez :
        </p>
        <ul>
          <li>Date d&rsquo;achat et raison de la vente (réelle).</li>
          <li>État détaillé : rayures, chocs, batterie restante, accessoires inclus.</li>
          <li>Wilayas livrées et mode de paiement accepté.</li>
          <li>Possibilité d&rsquo;essai sur place oui/non.</li>
        </ul>

        <h2>5. Répondre en moins d&rsquo;une heure</h2>
        <p>
          L&rsquo;acheteur a contacté trois vendeurs en même temps. Le
          premier qui répond, gagne. C&rsquo;est aussi simple que ça. Activez
          les notifications WhatsApp, et si vous n&rsquo;êtes pas disponible,
          répondez quand même un court &laquo;&nbsp;Disponible, je vous
          rappelle ce soir&nbsp;&raquo; — ça maintient la conversation.
        </p>

        <h2>6. Mettre à jour l&rsquo;annonce, pas la republier</h2>
        <p>
          Sur Teno Store, une annonce mise à jour reste indexée et garde son
          historique. Republier une annonce identique chaque semaine est
          contre-productif — ça dilue les signaux de fraîcheur et peut être
          détecté comme spam. Mettez plutôt à jour le prix ou la description
          pour signaler que vous êtes actif.
        </p>

        <h2>7. Le passage à l&rsquo;agent IA</h2>
        <p>
          C&rsquo;est ce qui distingue Teno Store d&rsquo;une plateforme
          classique : votre annonce est aussi exposée à des agents IA qui
          achètent au nom d&rsquo;acheteurs humains. Pour qu&rsquo;un agent
          retienne votre annonce, les détails techniques doivent être
          structurés — capacité, couleur, état, garantie en champs séparés
          plutôt que noyés dans un paragraphe. Le tableau de bord vendeur
          gère ça automatiquement si vous remplissez les champs proposés.
        </p>

        <h2>Pour aller plus loin</h2>
        <p>
          Si vous n&rsquo;avez pas encore de compte vendeur,{" "}
          <Link href="/seller">l&rsquo;inscription est gratuite</Link> et
          prend moins de deux minutes. Une fois inscrit, le tableau de bord
          vous guide annonce par annonce pour remplir les champs qui comptent.
        </p>
      </>
    );
  },
};
