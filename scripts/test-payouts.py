import importlib.util
from pathlib import Path
p=Path(__file__).with_name('update-payouts.py')
spec=importlib.util.spec_from_file_location('payouts',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows='\n'.join(f'{i}. pořadí / {i*100:,} Kč / 12x'.replace(',', ' ') for i in range(1,13))
html='<h2>Pátek 13. listopadu, 2026</h2><h3>Výherní pořadí</h3><div>'+rows.replace('\n','<br>')+'</div>'
result=m.parse(html)
assert result['2026-11-13']['prizes']==[i*100 for i in range(1,13)],result
assert not m.parse(html.replace('12. pořadí','11. pořadí'))
assert m._money('1 250 Kč')==1250
print('Payout parser fixture OK')

# Real Czech archive style: HTML table cells, nonbreaking spaces, 0 winners.
prizes=[None,8636843,1262794,127816,6372,4335,1980,740,459,371,371,241]
html='<h2>Pátek 13. listopadu, 2026</h2><h3>Tabulka výher</h3><table>' + ''.join(
    '<tr><td>%d. pořadí</td><td>%s / %dx</td></tr>'%(i, ('-' if v is None else f'{v:,}'.replace(',', '\u00a0')+' Kč'), 0 if v is None else 1)
    for i,v in enumerate(prizes,1)) + '</table>'
assert m.parse(html)['2026-11-13']['prizes']==prizes
print('Published HTML payout format OK')

# Real published archive values for 10 Nov 2026 (source text structure).
nov10=[None,40974847,3851317,76231,7940,4365,3114,671,511,420,335,240]
rows=''.join(f'<tr><td>{i}. pořadí</td><td>{"-" if v is None else format(v, ",").replace(",", " ")+" Kč"} / {0 if v is None else 1}x</td></tr>' for i,v in enumerate(nov10,1))
fixture='<h2>Úterý 10. listopadu, 2026</h2><h3>Tabulka výher</h3><table>'+rows+'</table>'
assert m.parse(fixture)['2026-11-10']['prizes']==nov10
print('10 Nov 2026 published values fixture OK')
