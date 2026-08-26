import fs from 'fs';

let content = fs.readFileSync('server/routes/playlists.ts', 'utf8');
content = content.replace("formatted.map(item =>", "formatted.map((item: any) =>");
content = content.replace("unique.sort((a, b) => a.name.localeCompare(b.name));", "unique.sort((a: any, b: any) => a.name.localeCompare(b.name));");
fs.writeFileSync('server/routes/playlists.ts', content);
