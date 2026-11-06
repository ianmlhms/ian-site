"""The façade prototype area (houses17) and where its work files live: Grand-Rue, Boulevard Royal (Hamilius),
Place d'Armes and Place Guillaume - the old town core, ~370 game buildings."""
import os

BOX = [4700.0, 5230.0, 8600.0, 8960.0]         # game x0, x1, z0, z1 (m)
WORK = os.path.expanduser("~/Library/Caches/luxdrive-work/houses17")
TEX_DIR = os.path.join(WORK, "tex")             # the ACT oblique-photo atlas JPEGs (pulled by facade_fetch.py)
ZIP_URL = ("https://download.data.public.lu/resources/base-de-donnees-nationale-des-batiments-3d-2023/"
           "20260325-131430/act2023v2-bati3d-luxembourg.zip")
ZIP_TEX_PREFIX = "ACT2023v2_bati3d_Luxembourg_appearance\\"
