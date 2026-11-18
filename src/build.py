import sys
d = open('data.js', encoding='utf-8').read()
e = open('engine.js', encoding='utf-8').read()
a = open('app.js', encoding='utf-8').read()
t = open('template.html', encoding='utf-8').read().replace('/*DATA*/', d).replace('/*ENGINE*/', e).replace('/*APP*/', a)
open('../index.html', 'w', encoding='utf-8').write(t)
print('built', len(t))
