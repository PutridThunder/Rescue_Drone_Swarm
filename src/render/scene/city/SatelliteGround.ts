// Satellite view: swaps the ground's land-cover colours for the area's Sentinel-2 image
// (satellite.jpg, bundled by the Python pipeline). The image loads the first time it is shown.

import * as THREE from "three";

export class SatelliteGround {
  private readonly mapMaterial: THREE.Material;
  private photoMaterial: THREE.MeshLambertMaterial | null = null;

  constructor(
    private readonly ground: THREE.Mesh,
    private readonly url: string,
  ) {
    this.mapMaterial = ground.material as THREE.Material;
  }

  setOn(on: boolean) {
    this.ground.material = on ? this.photo() : this.mapMaterial;
  }

  private photo(): THREE.Material {
    if (!this.photoMaterial) {
      const texture = new THREE.TextureLoader().load(this.url);
      texture.flipY = false; // the ground's UV row 0 is the north edge, like the image's first row
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this.photoMaterial = new THREE.MeshLambertMaterial({ map: texture });
    }
    return this.photoMaterial;
  }
}
