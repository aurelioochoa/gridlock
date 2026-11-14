import './style.css';
import { detectLang, setLang, setBlank } from './i18n';
import { Game } from './game';

const params = new URLSearchParams(location.search);
setLang(detectLang());
// `?blank=1` empties every string: the game must still play (design §11), and smoke proves it.
if (params.get('blank') === '1') setBlank(true);

const root = document.getElementById('app')!;
const game = new Game(root);
if (params.get('debug') === '1') (window as unknown as { __gridlock: Game }).__gridlock = game;
