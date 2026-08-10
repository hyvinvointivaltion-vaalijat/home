import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL puuttuu ympäristömuuttujista.");
}

if (!SUPABASE_SECRET_KEY) {
  throw new Error(
    "SUPABASE_SECRET_KEY tai SUPABASE_SERVICE_ROLE_KEY puuttuu ympäristömuuttujista."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);


/* ---------------------------------------------------------
   Apufunktiot
--------------------------------------------------------- */

function assertResult(result, label) {
  if (result.error) {
    throw new Error(
      `${label}: ${result.error.message}`
    );
  }

  return result.data;
}


function mapBoardMember(member) {
  const output = {
    name: member.name,
    role: member.role,
  };

  if (member.email) {
    output.email = member.email;
  }

  if (member.phone) {
    output.phone = member.phone;
  }

  if (member.profile_url) {
    output.profile_url = member.profile_url;
  }

  if (member.image) {
    output.image = member.image;
  }

  if (member.note) {
    output.note = member.note;
  }

  return output;
}


function mapDocument(document) {
  const output = {
    title: document.title,
  };

  if (document.description) {
    output.description = document.description;
  }

  if (document.date) {
    output.date = document.date;
  }

  if (document.type) {
    output.type = document.type;
  }

  if (document.url) {
    output.url = document.url;
  }

  return output;
}


/*
 * Muutetaan Supabasen association_news-rivi
 * julkiseen yhdistys.json-muotoon.
 */
function mapNewsItem(news) {
  const output = {
    id: news.id,
    title: news.title,
    status: news.status,
    pinned: Boolean(news.pinned),
    sort_order: news.sort_order ?? 9999,
  };

  if (news.kicker) {
    output.kicker = news.kicker;
  }

  if (news.excerpt) {
    output.excerpt = news.excerpt;
  }

  if (news.body) {
    output.body = news.body;
  }

  if (news.published_at) {
    output.published_at = news.published_at;
  }

  if (news.image_url) {
    output.image_url = news.image_url;
  }

  if (news.link_url) {
    output.link_url = news.link_url;
  }

  if (news.link_label) {
    output.link_label = news.link_label;
  }

  return output;
}


/* ---------------------------------------------------------
   Yhdistys
--------------------------------------------------------- */

async function exportYhdistys() {

  const now = new Date().toISOString();

  const [
    associationResult,
    boardResult,
    documentsResult,
    newsResult,
  ] = await Promise.all([

    /*
     * Yhdistyksen perustiedot
     */
    supabase
      .from("association")
      .select("*")
      .eq("id", "main")
      .single(),


    /*
     * Hallitus
     */
    supabase
      .from("association_board_members")
      .select("*")
      .order("sort_order", {
        ascending: true,
      }),


    /*
     * Asiakirjat
     */
    supabase
      .from("association_documents")
      .select("*")
      .order("group_sort_order", {
        ascending: true,
      })
      .order("sort_order", {
        ascending: true,
      }),


    /*
     * AJANKOHTAISTA
     *
     * Mukaan otetaan:
     *
     *   status = julkaistu
     *
     * ja
     *
     *   published_at puuttuu
     *   TAI
     *   published_at on jo saavutettu
     *
     * Näin tulevaisuuteen ajoitetut julkaisut
     * eivät päädy julkiseen JSONiin.
     */
    supabase
      .from("association_news")
      .select("*")
      .eq("status", "julkaistu")
      .or(
        `published_at.is.null,published_at.lte.${now}`
      )
      .order("pinned", {
        ascending: false,
      })
      .order("published_at", {
        ascending: false,
      })
      .order("sort_order", {
        ascending: true,
      }),
  ]);


  /* -------------------------------------------------------
     Tarkistetaan haut
  ------------------------------------------------------- */

  const association = assertResult(
    associationResult,
    "Yhdistyksen ydintietojen haku epäonnistui"
  );

  const boardRows = assertResult(
    boardResult,
    "Hallituksen tietojen haku epäonnistui"
  );

  const documentRows = assertResult(
    documentsResult,
    "Yhdistyksen asiakirjojen haku epäonnistui"
  );

  const newsRows = assertResult(
    newsResult,
    "Ajankohtaisten tiedotteiden haku epäonnistui"
  );


  /* -------------------------------------------------------
     Asiakirjaryhmät
  ------------------------------------------------------- */

  const documentGroups = new Map();

  for (const document of documentRows) {

    const key = document.group_title;

    if (!documentGroups.has(key)) {

      documentGroups.set(key, {
        title: document.group_title,
        _sort: document.group_sort_order,
        empty_text:
          document.group_empty_text || undefined,
        items: [],
      });
    }

    const group = documentGroups.get(key);

    if (document.group_empty_text) {
      group.empty_text =
        document.group_empty_text;
    }

    if (document.title) {
      group.items.push(
        mapDocument(document)
      );
    }
  }


  const documents =
    [...documentGroups.values()]
      .sort(
        (left, right) =>
          left._sort - right._sort
      )
      .map(
        ({ _sort, ...group }) =>
          group
      );


  /* -------------------------------------------------------
     Lopullinen yhdistys.json
  ------------------------------------------------------- */

  return {

    /*
     * Yhdistyksen perustiedot
     */
    name: association.name,
    short_name: association.short_name,
    kicker: association.kicker,
    mission: association.mission,
    role_in_atlas: association.role_in_atlas,

    activities_title:
      association.activities_title,

    activities:
      association.activities,

    chair:
      association.chair,

    updated:
      association.updated,

    links:
      association.links,

    membership:
      association.membership,


    /*
     * Hallitus
     */
    board: {
      lead:
        association.board_lead,

      members:
        boardRows.map(
          mapBoardMember
        ),
    },


    /*
     * Asiakirjat
     */
    documents,


    /*
     * AJANKOHTAISTA
     *
     * Tämä on nyt osa yhdistys.json-tiedostoa.
     */
    news:
      newsRows.map(
        mapNewsItem
      ),
  };
}


/* ---------------------------------------------------------
   Main
--------------------------------------------------------- */

async function main() {

  console.log(
    "Haetaan yhdistyksen julkinen aineisto Supabasesta…"
  );

  const yhdistysExport =
    await exportYhdistys();


  await writeFile(
    "yhdistys.json",
    `${JSON.stringify(
      yhdistysExport,
      null,
      2
    )}\n`,
    "utf8"
  );


  console.log(
    `Valmis: ` +
    `${yhdistysExport.board.members.length} hallituksen jäsentä, ` +
    `${yhdistysExport.documents.length} asiakirjaryhmää ja ` +
    `${yhdistysExport.news.length} julkaistua tiedotetta.`
  );
}


main().catch((error) => {

  console.error(
    "Yhdistyksen JSON-export epäonnistui:",
    error
  );

  process.exitCode = 1;
});
