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
