V**Dossier d'Architecture Technique (DAT)** condensé. 
-----

# ⛽ Projet : Comparateur Carburant Metz-Lux-Belgique (Release 2)

### 👤 Contexte Utilisateur

  * **Profil :** Technicien informatique (UFR SCIFA, Metz).
  * **Objectif :** PWA cartographique pour frontaliers.
  * **Stack :** Node.js (Backend), Leaflet.js (Frontend), TomTom Search API (POI).
  * **Hébergement :** Render.com (Gratuit) + GitLab Université (UL).

### 🏗️ Architecture du Projet (Modulaire)

Le projet est divisé pour assurer la maintenance et la stabilité des données par pays.

  * **`/backend-lux-prices.js`** : Point d'entrée Express. Gère les proxys (France/Allemagne), le cache Espagne (12k stations) et le scraping Luxembourg (Petrol.lu).
  * **`/api/belgium.js`** : Module dédié à la Belgique. Utilise un dictionnaire manuel par province pour pallier le blocage des sites officiels (Cloudflare) et la confusion entre Diesel "Pompe" et "B7".
  * **`/public/`** : Dossier statique contenant `index.html`, `style.css` et `app.js` (Logique Leaflet et appels API).

### 🇧🇪 Logique Spécifique Belgique

  * **Source de données :** Relevés manuels ([Carbu.com/Energiafed](https://www.google.com/search?q=https://Carbu.com/Energiafed)).
  * **Précision :** Mapping par province via le champ `subAdministrativeArea` de TomTom.
  * **Prix de référence (Avril 2026) :** \* *Province de Luxembourg (Arlon) :* **Diesel B7 @ 2,199 €**.
      * *Mécanisme :* L'application appelle `/api/belgium-prices?province=Nom_Province`.

### 🛠️ Configuration Serveur (`package.json`)

  * **Dépendances :** `express`, `axios`, `cheerio`, `cors`.
  * **Commande de lancement :** `npm start` (lance `node backend-lux-prices.js`).

### 📡 Endpoints API

1.  `GET /api/lux-prices` : Retourne les prix nationaux du Luxembourg (Scraping temps réel).
2.  `GET /api/belgium-prices?province=...` : Retourne les prix provinciaux belges (Dictionnaire manuel).
3.  `GET /api/france-proxy?lat=...&lng=...` : Proxy vers l'API OpenData France (Gouv).
4.  `GET /api/spain-proxy?lat=...&lng=...` : Filtre le cache local des stations espagnoles.

-----

### 📝 Notes pour la prochaine session

  * Le déploiement se fait via GitLab vers Render.
  * Le fichier `.gitignore` doit exclure `node_modules/`.
  * La prochaine étape est la validation des prix à Arlon sur le terrain.

-----

