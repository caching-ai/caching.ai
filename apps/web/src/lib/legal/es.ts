import type { LegalSet } from "./types";

export const es: LegalSet = {
  terms: {
    title: "Términos del servicio",
    updated: "Última actualización: 17 de julio de 2026",
    sections: [
      {
        h: "1. El servicio",
        body: [
          "Caching.ai (el «Servicio») es un proxy para APIs de modelos de lenguaje de gran tamaño, operado por AI3 Inc. («nosotros»). Tú apuntas tu SDK a nuestro endpoint con tus propias claves API de proveedor; nosotros reenviamos tus peticiones, medimos el uso de caché, protegemos y, opcionalmente, recalentamos tu caché de prompts, y reportamos el ahorro en tu panel.",
          "El Servicio se sitúa entre tu aplicación y tu proveedor de IA. Tu contrato con cada proveedor (Anthropic, OpenAI, Google, xAI y otros) sigue siendo tuyo — usar el Servicio no cambia tus obligaciones con ellos.",
        ],
      },
      {
        h: "2. Cuentas",
        body: [
          "Necesitas una cuenta para usar el Servicio. Eres responsable de la actividad que ocurra bajo tu cuenta y de mantener confidenciales tus credenciales y claves de Caching.ai. Debes proporcionar información veraz y tener capacidad legal para celebrar este acuerdo.",
        ],
      },
      {
        h: "3. Cuotas y facturación",
        body: [
          "El precio es por rendimiento: cada mes natural calculamos tu ahorro verificado contra los precios de lista del proveedor, restamos el coste de las peticiones de keep-alive que enviamos por ti y cobramos el 20% del ahorro neto restante a tu método de pago registrado al cerrar el mes.",
          "Las cuotas mensuales inferiores a $5 se exoneran y nunca se acumulan. Si no se verifica ningún ahorro, no se cobra ninguna cuota. Las cuotas no incluyen impuestos; donde corresponda, los impuestos se añaden al tipo aplicable.",
          "Las cifras de ahorro se calculan a partir del uso de tokens reportado por el proveedor y de los precios de lista publicados. Tu panel muestra el importe acumulado durante todo el mes.",
        ],
      },
      {
        h: "4. Tus responsabilidades",
        body: [
          "Debes usar el Servicio solo con cuentas de proveedor que estés autorizado a usar, y cumpliendo los términos de cada proveedor y la ley aplicable. No debes usar el Servicio para enviar contenido ilícito, para sondear o interrumpir el Servicio, ni para revenderlo sin nuestro consentimiento por escrito.",
          "Eres responsable de las claves API de proveedor que registres. Puedes eliminarlas en cualquier momento desde la consola.",
        ],
      },
      {
        h: "5. Tratamiento de datos",
        body: [
          "Por defecto almacenamos recuentos de tokens, nombres de modelo, latencia, códigos de estado y hashes de los bloques de prefijo del prompt — no el contenido de tus prompts ni de tus respuestas. Si activas la función opcional de keep-alive, almacenamos el prefijo de tu prompt (system prompt, tools y mensajes hasta el último breakpoint de caché) cifrado con AES-256-GCM, únicamente para recalentar tu caché; este trade-off se indica en el propio interruptor, y al desactivarlo el prefijo almacenado se elimina de inmediato.",
          "Los detalles se describen en nuestra Política de privacidad.",
        ],
      },
      {
        h: "6. Disponibilidad y exención de garantías",
        body: [
          "El Servicio se ofrece «tal cual» y «según disponibilidad». No garantizamos un funcionamiento ininterrumpido, y las cifras de ahorro son estimaciones basadas en el uso reportado por el proveedor y en los precios de lista. En la máxima medida permitida por la ley, rechazamos todas las garantías implícitas, incluidas la comerciabilidad y la idoneidad para un fin determinado.",
        ],
      },
      {
        h: "7. Limitación de responsabilidad",
        body: [
          "En la máxima medida permitida por la ley, nuestra responsabilidad total derivada del Servicio o relacionada con él se limita a las cuotas que nos hayas pagado en los tres meses anteriores a la reclamación. No respondemos por daños indirectos, incidentales, especiales o consecuentes, ni por pérdida de beneficios, datos o fondo de comercio.",
        ],
      },
      {
        h: "8. Suspensión y terminación",
        body: [
          "Puedes dejar de usar el Servicio y eliminar tu cuenta en cualquier momento. Podemos suspender o cancelar cuentas que infrinjan estos términos o supongan un riesgo para el Servicio u otros usuarios. Las cuotas devengadas siguen siendo exigibles tras la terminación.",
        ],
      },
      {
        h: "9. Cambios",
        body: [
          "Podemos actualizar estos términos a medida que el Servicio evolucione. Para cambios sustanciales avisaremos en el sitio o por email antes de que entren en vigor. Seguir usando el Servicio después de la fecha de entrada en vigor implica que aceptas los términos actualizados.",
        ],
      },
      {
        h: "10. Ley aplicable y contacto",
        body: [
          "Estos términos se rigen por las leyes de la República de Corea, sin atender a sus normas de conflicto de leyes. ¿Preguntas? Escríbenos a support@caching.ai.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de privacidad",
    updated: "Última actualización: 17 de julio de 2026",
    sections: [
      {
        h: "1. Qué recopilamos",
        body: [
          "Datos de cuenta: tu dirección de email, una contraseña con hash (o el email de tu cuenta de Google si inicias sesión con Google) y tu preferencia de idioma.",
          "Metadatos de uso: recuentos de tokens por petición, nombres de modelo, latencia, códigos de estado y hashes de los bloques de prefijo del prompt — usados para calcular tasas de acierto, ahorro y desperdicio.",
          "Las claves API de proveedor que registres, cifradas en reposo con AES-256-GCM y usadas solo para reenviar tus peticiones.",
          "Datos de facturación: tu método de pago lo custodian nuestros procesadores de pago (Stripe, o Toss Payments para usuarios de Corea) como token. Nunca vemos ni almacenamos números de tarjeta completos.",
        ],
      },
      {
        h: "2. Qué no recopilamos",
        body: [
          "No almacenamos el contenido de tus prompts ni de tus respuestas. La única excepción es la función opcional de keep-alive: al activarla, almacenamos el prefijo de tu prompt — el system prompt, las tools y los mensajes hasta el último breakpoint de caché — cifrado con AES-256-GCM, únicamente para recalentar la caché de tu proveedor. Desactiva el interruptor (o revoca la clave) y el prefijo almacenado se elimina de inmediato.",
        ],
      },
      {
        h: "3. Por qué lo tratamos",
        body: [
          "Para operar el proxy y tu panel, calcular las cuotas por rendimiento, enviar emails transaccionales (verificación, recibos) y — salvo que lo desactives — un informe periódico de ahorro, y para mantener seguro el Servicio.",
        ],
      },
      {
        h: "4. Conservación",
        body: [
          "Los datos de cuenta se conservan mientras exista tu cuenta. Los metadatos de peticiones se conservan el tiempo necesario para ofrecer analytics e historial de facturación. Al eliminar tu cuenta, los datos personales asociados se eliminan o anonimizan de forma irreversible en un plazo de 30 días, salvo que la ley exija una conservación mayor (p. ej., registros de facturación).",
        ],
      },
      {
        h: "5. Compartición y encargados",
        body: [
          "No vendemos datos personales. Compartimos datos solo con los encargados necesarios para operar el Servicio: alojamiento en la nube, procesadores de pago (Stripe, Toss Payments) y nuestro proveedor de email transaccional. Cada uno trata los datos únicamente según nuestras instrucciones.",
        ],
      },
      {
        h: "6. Seguridad",
        body: [
          "Todo el tráfico se cifra en tránsito (TLS). Las claves de proveedor y los prefijos de prompt opt-in se cifran en reposo con AES-256-GCM. En el servicio alojado, el acceso a los datos de producción está restringido a un conjunto mínimo de operadores.",
        ],
      },
      {
        h: "7. Tus derechos",
        body: [
          "Puedes acceder a tus datos, corregirlos, exportarlos o eliminarlos. Las claves, las claves de proveedor, las tarjetas y la propia cuenta se pueden eliminar directamente en la consola; para cualquier otra cosa, escribe a support@caching.ai y responderemos con prontitud. Puedes darte de baja de los emails de informes con un clic desde cualquier informe.",
        ],
      },
      {
        h: "8. Usuarios internacionales",
        body: [
          "El Servicio se opera desde la República de Corea. Al usarlo, entiendes que tus datos se tratan allí y por los encargados indicados arriba.",
        ],
      },
      {
        h: "9. Cambios y contacto",
        body: [
          "Publicaremos aquí las actualizaciones de esta política y, para cambios sustanciales, te avisaremos en el sitio o por email. Contacto: support@caching.ai.",
        ],
      },
    ],
  },
};
