# Explorador de licitaciones públicas (OCDS Perú)

Esta aplicación web estática consulta la API pública de [Contrataciones Abiertas](https://contratacionesabiertas.oece.gob.pe/api/v1/records) para mostrar los procesos de contratación del Estado peruano publicados en formato OCDS.

## Características

- Consulta la API con paginación configurable (20, 50 o 100 registros por página).
- Permite filtrar los resultados por código UNSPSC, departamento, entidad compradora y palabras clave en la descripción.
- Presenta la información en una tabla con enlaces directos a los releases oficiales y datos relevantes como monto estimado, fechas y OCID.
- Maneja errores de conexión mostrando mensajes claros al usuario.

## Requisitos

La página consume la API directamente desde el navegador, por lo que es recomendable ejecutarla desde un servidor local para evitar bloqueos por CORS.

## Ejecución local

1. Clona o descarga este repositorio.
2. Abre una terminal en la carpeta del proyecto.
3. Inicia un servidor HTTP simple, por ejemplo con Python:

   ```bash
   python -m http.server 8000
   ```

4. Visita [http://localhost:8000/index.html](http://localhost:8000/index.html) en tu navegador.

## Uso

1. Ajusta los filtros deseados en el formulario (código UNSPSC, departamento, entidad compradora y/o descripción).
2. Haz clic en **Buscar** para consultar la API con los filtros actuales.
3. Utiliza los botones de navegación para avanzar o retroceder entre páginas.
4. Pulsa **Limpiar filtros** para restablecer el formulario y volver a la primera página.

## Notas

- La API es paginada; el sitio solicita una página a la vez y aplica los filtros en el cliente.
- Si la API introduce parámetros de filtrado nativos en el futuro, se podrían incorporar fácilmente en `main.js`.
- Ante errores de red o restricciones de acceso, la página mostrará un mensaje de aviso y permitirá reintentar la consulta.
