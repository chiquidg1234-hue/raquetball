# Decisiones de la fase 0

## Destino de despliegue — decidido antes de escribir la primera vista

El spec pide decidirlo en la fase 0 porque cambia como se escribe el proyecto.
Los tres requisitos duros son: **costo cero, sin backend, acceso controlado**.

**Decision: proyecto npm + Vite + TypeScript, con un build que emite un unico
archivo HTML autocontenido.**

Un solo archivo sirve simultaneamente a las tres opciones que plantea el spec:

| Destino | Como se usa el build |
|---|---|
| Artifact de Claude | Se publica `dist/racquetball.html`. Privado por defecto, se comparte a dedo. |
| Cloudflare Pages + Access | Se publica `dist/` entero. Mismo archivo, dominio propio y lista de correos. |
| Repo privado + `npm run dev` | Vite en local, sin desplegar nada. |

Consecuencias que hay que respetar al escribir codigo:

1. **Three.js va inline en el bundle, no por CDN.** El spec sugiere cargarlo desde
   `cdnjs` si el destino es un Artifact. Inlinearlo cumple igual la restriccion
   (solo se permiten scripts externos de cdnjs; cero scripts externos tambien vale)
   y ademas hace que la app funcione sin red. Cuesta ~600 KB del limite de 16 MB.
2. **Cero `fetch` a hosts externos.** Todos los datos son locales.
3. **Cero assets externos.** Sin fuentes de Google, sin imagenes remotas. Los
   iconos son SVG inline y la tipografia es la del sistema.
4. **Nada de backend, nunca.** El estado vive en `localStorage`, en JSON
   exportado y en el hash de la URL comprimido con `lz-string`.

GitHub Pages queda descartado como dice el spec: desde un repo privado exige plan
de pago, asi que "gratis" y "privado" no se dan a la vez.

## Convenio de radio de pelota — fijado aqui, verificado por test

Todas las pruebas de colision se hacen contra planos **desplazados hacia adentro
por `BALL.radius`**. Todo punto que se registra o se dibuja es el **centro** de la
pelota. El volumen donde puede estar ese centro es

```
[r, width-r] x [r, height-r] x [r, length-r]
```

`tests/engine-geometric.spec.ts` lo verifica en los seis lados y comprueba que
ningun punto de contacto mete la pelota dentro de la pared.

## Contrato `Trajectory` — congelado al terminar la fase 1

`src/core/types.ts` es el unico contrato entre el motor y todo lo demas. Las tres
vistas 2D son proyecciones ortograficas del mismo arreglo de puntos que usa la 3D:
planta descarta Y, alzado frontal descarta Z, alzado lateral descarta X. No hay
"motor 2D", y por construccion las vistas no pueden desincronizarse.

---

## Donde este codigo se aparta del spec, y por que

Tres sitios. En los tres, seguir el documento al pie de la letra habria producido algo
peor o directamente contradictorio consigo mismo.

### 1. Los presets guardan un punto de mira, no un angulo

El spec dice que cada preset guarda "azimut/elevacion/velocidad **relativos a la
posicion del jugador**". Guardar el angulo crudo no cumple esa promesa: el mismo pinch
tirado desde el centro y desde la esquina necesita angulos distintos para morir en el
mismo sitio.

Se guarda el punto al que se apunta y se DERIVA el angulo desde donde este el jugador.
Eso si cumple lo que el spec pedia, y ademas es como lo ensena un entrenador: "pegale a
la pared ahi".

### 2. El Z serve es legal

El spec dice, en la validacion de saque: *"Si pega una lateral antes del piso →
three-wall serve, falta"*. Esa regla marcaria como falta el **Z serve**, que es un saque
legal y que esta en la lista de presets del propio spec, dos secciones mas arriba.

La regla real del racquetball es que el saque es falta si toca **tres** paredes (la
frontal y otras dos) antes de botar. Frontal mas UNA lateral es legal: eso es
exactamente un Z serve. Se implementa la regla real y hay un test que exige que el Z
serve salga legal.

### 3. El orden del bloque 3 se reordeno

El spec ordena el bloque final como 9 (pizarra), 10 (inverso), 11 (persistencia), 12
(entrega). Se hizo 11 → 10 → 9 → 12.

Razon: la fase 11 es la que hace utilizable y compartible todo lo ya construido, y el
propio spec dice que la 9 "es la fase que mas horas consume por unidad de dificultad".
Trabajando con un presupuesto limitado, adelantar lo que da mas valor por hora reduce el
riesgo de quedarse sin tiempo con la app sin forma de compartirla. Se entregaron las
cuatro igualmente.

---

## Dos bugs que solo aparecieron al probar de verdad

Se dejan escritos porque los dos eran silenciosos: ninguno daba error, los dos
"funcionaban" a la vista.

### El empaquetado de un solo archivo producia un archivo roto

`String.replace` con un reemplazo de TEXTO interpreta `$&`, `` $` ``, `$'` y `$1` como
patrones. El bundle de `lz-string` contiene el alfabeto base64 url-safe, que acaba en
`+-$`, y ese `$` iba seguido de una comilla invertida. El motor lo leyo como `` $` `` e
inserto **todo el HTML anterior** en mitad del codigo JavaScript.

El archivo resultante pesaba lo esperado, no pedia nada a la red y parecia correcto.
Simplemente moria con `Invalid left-hand side in assignment` y la app no arrancaba.

Arreglado usando una funcion de reemplazo, que no interpreta nada. Y para que no vuelva:
el script ahora comprueba que el codigo dentro del HTML es byte a byte el del bundle, y
falla el build si no lo es.

### Restaurar un tiro desde la URL dejaba los sliders mentirosos

Al abrir un enlace compartido, el estado se restauraba bien y las tres vistas dibujaban
el tiro correcto. Pero los sliders seguian mostrando los valores con los que se habian
construido: la pantalla decia "azimut 0°" mientras dibujaba un tiro a -24°.

El redibujo de arranque pasaba a los paneles un conjunto de cambios **vacio** en vez del
conjunto completo de claves, asi que ningun panel se refrescaba. Solo se ve abriendo un
enlace compartido en una pestana nueva y comparando el numero con el dibujo.

---

# Decisiones del encargo del 24-09 (física, saque y raqueta)

Las fuentes de cada número están en [INVESTIGACION.md](INVESTIGACION.md).

## El COR se saca de la norma CON aire

El COR se había calculado con `sqrt(70/100) = 0.837`, que supone que no hay aire. El
motor sí tiene aire, y al hacer la prueba de homologación dentro de él la pelota rebotaba
a **64.6 in**: no pasaba su propia norma (68-72 in). La caída y la subida verticales con
arrastre cuadrático tienen solución cerrada (`corFromDropTest` en `atmosphere.ts`); con
ella el rango legal es 0.859-0.885 y la pelota de referencia vale 0.872. Dos tests que
codificaban la suposición vieja se reescribieron, no se borraron.

## Las superficies arrancan iguales

No hay ni una medida publicada del rebote de una pelota de racquetball contra panel,
revoque, cristal, madera o cemento. La patente de los paneles dice que rebotan "igual" que
el hormigón. La hipótesis del encargo ("el hormigón devuelve más y raspa más") no tiene
respaldo, así que no se codifica como dato: todas las superficies empiezan con factor 1 y
se calibran a mano en el panel Cancha. "Cancha de placa" no aparece definida en ninguna
fuente; se ofrecen las dos lecturas con nombre descriptivo.

## El contacto del revés va más adelantado, no menos

El encargo decía que la derecha se golpea más adelantada que el revés. Las guías dicen:
derecha a la altura del talón delantero; revés igual o "justo por delante del pie
adelantado" (Rocky Carson). Se modela lo que dicen las fuentes y un test lo fija.

## El bote de la mano vive en su propia Trajectory

El saque se simula con el mismo motor, pero en una `Trajectory` aparte. Así es imposible
que su bote entre en la numeración del tiro, que es lo que Gael pidió con el ejemplo del
lob Z serve. En modo saque la altura de contacto la da ese bote; los documentos guardan el
origen EFECTIVO y los parámetros del saque, para que un enlace reproduzca el mismo tiro.

## El Z serve baja de 42 a 39 m/s

Con la pelota corregida (más viva) el preset Z serve quedaba al borde del saque largo:
legal con contacto a 0.72 m, largo a 0.65. A 39 m/s es legal con cualquier contacto entre
0.55 y 1.05 m, y un test lo vigila con la altura que da el bote de mano por defecto.

## Documento v2, que sigue leyendo los v1

El sitio de juego viaja en la URL y en el JSON (`venue`), y el saque también (`serve`).
Un documento v1 no trae cancha: se lee con la de referencia (nivel del mar, 20 °C), que es
el aire con el que se hizo.

## Velocidades de radar

Todas las lecturas publicadas son de radar, que marca el pico, es decir la velocidad a la
salida de la raqueta. El "saque pro 75-85 m/s" del spec era nivel récord; un pro normal
saca a 63-72 m/s. El máximo del slider pasa de 90 a 85 m/s (~190 mph).
