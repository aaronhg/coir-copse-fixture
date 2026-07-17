import { _decorator, Component, Label, Node, Sprite, SpriteFrame, Color, tween, Tween, Vec3, UIOpacity } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Tiny-Dungeon fixture. Tap Attack to trade blows with the monster.
 * The hero strikes first; a surviving monster may strike back (you can also miss).
 * Slay it → maybe descend, a different monster appears. Fall → the run resets.
 *
 * Buried bugs (for the coir×copse join to catch):
 *   #1  Menu button is left disabled (interactable=false)  → coverage: blocked
 *   #2  Flee button has no ClickEvent wired                → coverage: codeOnly
 *   #3  floorLabel is never refreshed (shown depth desyncs) → crossCheck
 *   #4  the "Defeated" tally is not reset on death          → reset flow
 */
@ccclass('DungeonGame')
export class DungeonGame extends Component {
  @property(Label) hpLabel;
  @property(Label) enemyHpLabel;
  @property(Label) killsLabel;
  @property(Label) floorLabel;
  @property(Label) floatText;          // transient popup (MISS!)
  @property(Node) heroNode;
  @property(Node) enemyNode;
  @property(Node) attackBtn;
  @property(Node) restartBtn;
  @property(Node) menuPanel;
  @property([SpriteFrame]) enemyFaces = [];   // several monster kinds, cycled on each kill
  @property([SpriteFrame]) heroFaces = [];    // several hero looks, one per run
  @property(Sprite) menuIcon;          // the gear / cross icon on the settings button
  @property(SpriteFrame) iconGear;
  @property(SpriteFrame) iconCross;

  public hp = 3;
  public floor = 1;
  public kills = 0;
  public enemyHp = 3;

  readonly MAX_HP = 3;
  readonly COUNTER_CHANCE = 0.4;
  readonly DESCEND_CHANCE = 0.3;     // chance a kill takes you down a floor
  readonly MISS_CHANCE = 0.2;        // chance the hero's swing whiffs
  readonly SEQ_TIME = 0.42;          // input is locked this long per attack

  private _busy = false;
  private _run = 0;
  private _heroBase = new Vec3();
  private _enemyBase = new Vec3();
  private _floatBase = new Vec3();

  // per-floor toughness: floor 1 → 3, floor 2 → 4, floor 3 → 5 ...
  enemyMax() { return 2 + this.floor; }

  onLoad() {
    this.menuPanel.active = false;
    this.restartBtn.active = false;
    this.enemyHp = this.enemyMax();
    this.setEnemyFace(0);              // start on monster A
    this.setHeroFace();               // pick this run's hero look
    if (this.floatText) this.floatText.string = '';
    if (this.menuIcon && this.iconGear) this.menuIcon.spriteFrame = this.iconGear;  // closed → gear
    this.refresh();
  }

  private faces() { return (this.enemyFaces || []).filter(f => !!f); }
  private setEnemyFace(i) {
    const faces = this.faces();
    if (!faces.length) return;
    const spr = this.enemyNode.getComponent(Sprite);
    if (spr) spr.spriteFrame = faces[i % faces.length];
  }
  private setHeroFace() {
    const hs = (this.heroFaces || []).filter(f => !!f);
    if (!hs.length) return;
    const spr = this.heroNode.getComponent(Sprite);
    if (spr) spr.spriteFrame = hs[this._run % hs.length];
  }
  start() {
    this._heroBase.set(this.heroNode.position);
    this._enemyBase.set(this.enemyNode.position);
    if (this.floatText) this._floatBase.set(this.floatText.node.position);
  }

  rollCounter() { return Math.random() < this.COUNTER_CHANCE; }
  rollDescend() { return Math.random() < this.DESCEND_CHANCE; }
  rollMiss()    { return Math.random() < this.MISS_CHANCE; }

  attack() {
    if (this._busy) return;
    const miss = this.rollMiss();
    let killed = false, countered = false;
    if (!miss) {
      this.enemyHp -= 1;
      if (this.enemyHp <= 0) {
        this.kills += 1;
        if (this.rollDescend()) this.floor += 1;   // 30%: descend a floor
        this.enemyHp = this.enemyMax();             // a fresh monster (tougher deeper)
        killed = true;
      }
    }
    // the monster strikes back only if it SURVIVED (a whiff or a non-lethal hit)
    if (!killed && this.rollCounter()) {
      this.hp -= 1;
      countered = true;
    }
    if (this.hp <= 0) {
      // game over — freeze the display at the fatal moment; the monster that felled you
      // keeps its remaining HP and stays standing (reset only happens on Restart)
      this.hpLabel.string = `HP: 0/${this.MAX_HP}`;
      this.enemyHpLabel.string = `Enemy HP: ${Math.max(0, this.enemyHp)}/${this.enemyMax()}`;
      // reset the run's own fields for the coming restart — tally kept (BUG #4)
      this.hp = this.MAX_HP;
      this.floor = 1;
      this.playDefeat();
      return;
    }
    this.playAttack(killed, countered, miss);
    this.refresh();                    // numbers update immediately; animation is cosmetic
  }

  // ---- choreography: hero strikes first, THEN the monster reacts ----
  private playAttack(killed, countered, miss) {
    this._busy = true;
    Tween.stopAllByTarget(this.heroNode);
    this.heroNode.setPosition(this._heroBase);
    tween(this.heroNode)
      .by(0.10, { position: new Vec3(0, 55, 0) })   // lunge up at the monster
      .by(0.10, { position: new Vec3(0, -55, 0) })  // return
      .call(() => {
        if (miss) {
          this.showFloat('MISS');                   // whiffed — no damage dealt
          if (countered) this.enemyReact(true);     // monster still strikes back
        } else {
          this.enemyHurt();                         // the monster flashes red (took a hit)
          if (killed) this.spawnNextEnemy();        // slain → squash, then a new monster
          else this.enemyReact(countered);          // survived → recoil, maybe strike back
        }
      })
      .start();
    this.scheduleOnce(() => { this._busy = false; }, this.SEQ_TIME);
  }

  private enemyReact(countered) {
    Tween.stopAllByTarget(this.enemyNode);
    this.enemyNode.setPosition(this._enemyBase);
    if (countered) {
      // survives AND strikes back → lunge DOWN at the hero (who stands below)
      tween(this.enemyNode)
        .by(0.08, { position: new Vec3(0, -40, 0) })
        .by(0.08, { position: new Vec3(0, 40, 0) })
        .start();
      this.heroHurt();
    } else {
      // just took the hit → a small recoil upward, no strike
      tween(this.enemyNode)
        .by(0.07, { position: new Vec3(0, 26, 0) })
        .by(0.07, { position: new Vec3(0, -26, 0) })
        .start();
    }
  }

  private heroHurt() { this.flashRed(this.heroNode); }
  private enemyHurt() { this.flashRed(this.enemyNode); }
  private flashRed(n) {
    const spr = n.getComponent(Sprite);
    if (!spr) return;
    Tween.stopAllByTarget(spr);
    spr.color = Color.WHITE.clone();
    tween(spr).to(0.06, { color: new Color(255, 85, 85, 255) })
              .to(0.16, { color: Color.WHITE.clone() }).start();
  }

  private showFloat(text) {
    const lbl = this.floatText;
    if (!lbl) return;
    const node = lbl.node;
    lbl.string = text;
    const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    Tween.stopAllByTarget(node);
    Tween.stopAllByTarget(op);
    node.setPosition(this._floatBase);
    op.opacity = 255;
    tween(op).to(0.55, { opacity: 0 }).start();
    tween(node).by(0.55, { position: new Vec3(0, 46, 0) }).start();
  }

  // monster defeated → it squashes flat, then a DIFFERENT monster pops in
  private spawnNextEnemy() {
    const node = this.enemyNode;
    const spr = node.getComponent(Sprite);
    const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    Tween.stopAllByTarget(node);
    Tween.stopAllByTarget(op);
    tween(node)
      .to(0.22, { scale: new Vec3(1.4, 0, 1) })     // squash the slain monster
      .call(() => {
        this.setEnemyFace(this.kills);              // next kind of monster
        if (spr) spr.color = Color.WHITE.clone();
        node.setPosition(this._enemyBase);
        node.setScale(0.3, 0.3, 1);
        op.opacity = 0;
        tween(op).to(0.20, { opacity: 255 }).start();
      })
      .to(0.20, { scale: new Vec3(1, 1, 1) })        // the new monster pops in
      .start();
  }

  // ---- player defeated → GAME OVER: only the hero falls; the monster stands victorious ----
  private playDefeat() {
    this._busy = true;
    this.attackBtn.active = false;
    this.squash(this.heroNode);
    this.scheduleOnce(() => { this.restartBtn.active = true; }, 0.45);
  }

  private squash(n) {
    Tween.stopAllByTarget(n);
    tween(n).to(0.35, { scale: new Vec3(1.5, 0, 1) })
            .call(() => { n.active = false; }).start();
  }

  restart() {
    const pairs = [[this.heroNode, this._heroBase], [this.enemyNode, this._enemyBase]];
    for (const [n, base] of pairs) {
      Tween.stopAllByTarget(n);
      n.active = true;
      n.setScale(1, 1, 1);
      n.setPosition(base);
      const spr = n.getComponent(Sprite); if (spr) spr.color = Color.WHITE.clone();
      const op = n.getComponent(UIOpacity); if (op) op.opacity = 255;
    }
    this._run += 1;                    // a new run → a new hero look
    this.enemyHp = this.enemyMax();    // a fresh monster for the new run
    this.setEnemyFace(0);              // fresh run starts on monster A
    this.setHeroFace();
    this.restartBtn.active = false;
    this.attackBtn.active = true;
    this._busy = false;
    this.refresh();
  }

  toggleMenu() { this.setMenu(!this.menuPanel.active); }   // the gear button
  closeMenu()  { this.setMenu(false); }                    // the X inside the panel
  private setMenu(open) {
    this.menuPanel.active = open;
    if (this.menuIcon) this.menuIcon.spriteFrame = open ? this.iconCross : this.iconGear;
  }

  refresh() {
    this.hpLabel.string = `HP: ${Math.max(0, this.hp)}/${this.MAX_HP}`;
    this.enemyHpLabel.string = `Enemy HP: ${Math.max(0, this.enemyHp)}/${this.enemyMax()}`;
    this.killsLabel.string = `Defeated: ${this.kills}`;
    // BUG #3: floorLabel is never refreshed — the shown depth desyncs from the real floor
  }
}
