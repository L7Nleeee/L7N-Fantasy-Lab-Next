// Photo switch (Settings → 顯示球員照片). Official NBA.com headshots are addressed ONLY by NBA player id (see nba-image.js);
// a player without a verified id shows the initials avatar. Images load straight from cdn.nba.com in the visitor's browser and are not
// mirrored in this project. Public / commercial redistribution may require checking NBA image and trademark terms.
import { setPhotosEnabled } from '../components/avatar.js';

export function createHeadshots({ enabled = true } = {}) {
  let on = !!enabled; setPhotosEnabled(on);
  return { get enabled() { return on; }, setEnabled(v) { on = !!v; setPhotosEnabled(on); } };
}
