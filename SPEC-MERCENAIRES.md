# Spec : mercenaires, douane, familles et mariages (1er/11/2026)

État : **validée le 1er/11/2026** (« passe directement au build, plusieurs agents »). Deuxième chantier de `tasks/idees-fonctionnalites.md`.

## Objectif

Trois leviers de plus dans la campagne : louer des régiments étrangers contre des livres ; régler une douane à ses
frontières (des livres contre du commerce, et la contrebande qui va avec) ; une famille à la tête de chaque camp,
dont le chef vieillit, meurt, se marie, et dont la succession peut tourner à la crise. Les IA vivent les mêmes règles.

## Choix du joueur (questionnaires du 1er/11/2026)

- Mercenaires : régiments étrangers selon l'époque, loués contre des livres, qui désertent si la solde manque.
- Douane : un tarif aux frontières réglé par chaque camp ; la contrebande grandit avec le tarif ; des douaniers la
  réduisent.
- Familles : une famille dirigeante par camp ; le chef a un trait et un âge ; ses héritiers lui succèdent.
- Crise de succession (chef mort sans héritier) : événement à choix, prétendant étranger, désordre.
- Mariage entre deux camps : relations et alliance, dot, droit de succession.
- Mêmes règles pour les IA.

## Ce qui existe (relevé du 1er/11)

- Unités : `rules.UNITS` (coût, solde `upkeep_l`, rations `upkeep_v`, `where`, `req`) ; `UNIT_YEAR` (date d'apparition)
  existe mais est vide, sans date de fin ; `engine.can_recruit`, `recruit`, file des places.
- Solde : un débit quotidien dans `compute_income` ; sans livres, `banqueroute` : désertion des armées
  (`engine.py:3837-3864`, « solde impayée ») et ordre public en baisse.
- Commerce : accords `f['trade']` (`compute_income`, :884-898) ; voisins : `diplomacy.borders`.
- Événements à choix (`game/events.py`, `EV.fire`) ; contrebande déjà en événements (`blocus` 1806, `contrebande`).
- Ordre public par place (`n['stab']`, cibles dans `stab_targets`).
- Diplomatie : `act` / `ai_evaluate` / `apply` / `answer` ; vassalité (`make_vassal`).
- Aucun chef de camp, aucune famille, aucun tarif.

## Décisions

### Mercenaires

1. **Quatre régiments étrangers**, avec des dates (`UNIT_YEAR` rempli, et une date de fin nouvelle, `UNIT_UNTIL`) :
   régiment suisse (infanterie, 1700-1792 puis 1815-1830), brigade irlandaise (infanterie, 1700-1791), Royal-Allemand
   (cavalerie, 1700-1791), Légion étrangère (infanterie, dès 1831).
2. **Coût** : des livres seulement (ni recrues ni armes) : une prime de deux fois celle d'un régiment de ligne, une
   solde double ; vétérans (expérience de départ plus haute), prêts plus vite. Recrutés dans le chef-lieu ou un port.
   Au plus 3 régiments étrangers par camp.
3. **Sans solde** (banqueroute), ils désertent trois fois plus vite que les autres.
4. **IA** : elle en loue en guerre quand elle manque de recrues et que son trésor dépasse trois fois sa réserve.

### Douane

5. **Tarif** par camp, quatre niveaux : libre (0), modéré (10 %), élevé (20 %), prohibitif (35 %).
6. **Recettes** : pour chaque voisin (frontière commune), le taux × le volume des échanges (la part du revenu brut du
   voisin que prend le commerce frontalier), moins la part qui passe en contrebande.
7. **Le prix** : les accords commerciaux avec ce camp rapportent moins à ses partenaires (×(1 − 1,5 × taux)) ; ses
   voisins l'aiment moins chaque mois (relations −0,5 par niveau).
8. **Contrebande** : sa part grandit avec le taux (×1,5) ; les **douaniers** (un réglage, coût en livres par place
   frontalière) la divisent par deux. Les événements de contrebande existants viennent plus souvent quand le tarif est
   élevé.
9. **IA** : un camp marchand garde un tarif bas, un camp pauvre ou en guerre le monte.

### Familles et successions

10. **La maison** de chaque camp (`f['maison']`) : un nom de famille du pays, un **chef** (nom, année de naissance,
    trait), sa femme ou son mari s'il est marié, ses **héritiers** (enfants nés au fil des ans). Titre selon l'époque
    (gouverneur, président du directoire, préfet…). Une ancienne sauvegarde reçoit une maison tirée au chargement.
11. **Traits du chef** (6, un petit effet sur le camp, par les mêmes modificateurs que les technologies) : bâtisseur
    (constructions −10 %), économe (soldes −5 %), belliqueux (recrues +10 %, relations −), diplomate (relations +,
    alliances plus faciles), savant (recherche +8 %), populaire (ordre public +0,05).
12. **Chaque année** : naissances (chef marié, moins de 45 ans), et mort selon l'âge (rare avant 50 ans, de plus en
    plus probable ensuite). À sa mort, l'aîné des héritiers lui succède (événement au journal).
13. **Crise de succession** (pas d'héritier) : un **événement à choix** : un cousin (ordre public en baisse), un notable
    élu (des livres), ou, si une maison alliée par mariage existe, le **prétendant étranger** (le camp devient vassal
    du sien) ; refuser le prétendant peut lui donner une guerre de succession. Pendant six mois, **désordre** : ordre
    public −0,1 dans tout le camp.
14. **Mariage** : nouvelle action de diplomatie entre deux camps en paix qui ont chacun un héritier ou un chef non
    marié. Effets : relations +25 des deux côtés, alliance plus facile, une **dot** en livres (le montant de la
    proposition), et un **droit de succession** réciproque. Faire la guerre à un camp lié par mariage coûte de l'ordre
    public quelques mois. Les IA marient leurs héritiers avec leurs voisins amis.
15. **Interface** : la carte de chaque camp (Diplomatie) montre son chef (nom, âge, trait), ses héritiers et ses liens
    de mariage, avec un bouton « Proposer un mariage » ; le panneau Commerce règle le tarif et les douaniers et montre
    recettes et contrebande ; les régiments étrangers apparaissent dans la liste de recrutement des places.
16. **Équilibre** : banc d'équilibre avant et après (1790, et 1700 pour les mercenaires de l'Ancien Régime).

## Risques

| Risque | Impact | Parade |
|---|---|---|
| Les mercenaires rendent les camps riches trop forts | Moyen | plafond de 3 ; solde double ; banc |
| La douane assèche le commerce | Moyen | taux réglés au banc ; un camp marchand garde un tarif bas |
| Des vassalités en chaîne par les successions | Moyen | le prétendant étranger seulement par mariage, et refusable |
| Trop d'événements au journal (naissances, mariages) | Bas | seules les morts, successions, crises et mariages du joueur ou de ses voisins sont importants |
| Anciennes sauvegardes | Bas | `views.migrate` tire une maison et règle le tarif à libre |

## Critères de réussite

1. Un régiment étranger se loue à son époque, coûte des livres, déserte vite sans solde ; les IA en louent en guerre.
2. Le tarif rapporte, coûte du commerce et des relations ; la contrebande suit le tarif et les douaniers.
3. Les chefs vieillissent, meurent, ont des héritiers ; une crise de succession propose ses choix et met le désordre.
4. Un mariage améliore les relations, paie la dot, ouvre le droit de succession.
5. Banc d'équilibre dans ses tolérances ; tous les tests passent.

## Hors périmètre

Généalogie détaillée (frères, cousins nommés) ; portraits des chefs ; marine marchande et douane maritime à part du
blocus ; compagnies franches.
