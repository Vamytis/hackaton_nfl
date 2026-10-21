Pass Pro Lab est une application web d'analyse de la protection de passe au football américain (NFL). Elle permet d'étudier les performances des joueurs et des équipes, d'identifier les actions problématiques et de visualiser les déplacements des joueurs grâce aux données de tracking.

## Fonctionnalités

- **Tableau de bord** : consultation des statistiques clés et comparaison avec les moyennes de la ligue.
- **Analyse des performances** : comparaison des joueurs, des postes et des formations offensives.
- **Détection des actions problématiques** : identification des sacks, hits, hurries et bloqueurs battus.
- **Rejeu des actions** : visualisation des déplacements des joueurs sur le terrain à partir des données de tracking.
- **Notes du coach** : ajout d'observations, définition des priorités et suivi des axes d'amélioration.
- **Import et export** : chargement des données CSV et export des notes au format JSON ou CSV mais par défaut nous avons mit les données publique de 2021.

## Installation et lancement

### Prérequis

- Python 3
- Un navigateur web récent
- Les fichiers CSV nécessaires au fonctionnement de l'application

### 1. Se placer dans le répertoire du projet

```bash
cd proj_nfl
```

### 2. Lancer un serveur HTTP local

Exécutez la commande suivante depuis la racine du projet :

```bash
python3 -m http.server 8000
```

### 3. Accéder à l'application

Ouvrez votre navigateur à l'adresse suivante :

http://localhost:8000
